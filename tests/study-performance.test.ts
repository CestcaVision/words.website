import { test } from "node:test";
import { createEmptyCard } from "ts-fsrs";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { root } from "../apps/api/store.ts";
import { settingsSchema } from "../packages/shared/schema.ts";
import { D1Store } from "../apps/worker/store.ts";
import type { SQL } from "../apps/worker/auth.ts";
function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(
    path.join(root, "database/d1-migrations"),
  ).sort())
    sqlite.exec(
      readFileSync(path.join(root, "database/d1-migrations", file), "utf8"),
    );
  let rows = 0,
    reads = 0;
  function prepare(sql: string) {
    let args: any[] = [];
    return {
      bind(...values: any[]) {
        args = values;
        return this;
      },
      async first() {
        reads++;
        const result = sqlite.prepare(sql).get(...args) || null;
        if (result) rows++;
        return result;
      },
      async all() {
        reads++;
        const results = sqlite.prepare(sql).all(...args);
        rows += results.length;
        return { results };
      },
      async run() {
        const r = sqlite.prepare(sql).run(...args);
        return {
          success: true,
          meta: {
            changes: Number(r.changes),
            last_row_id: Number(r.lastInsertRowid),
          },
        };
      },
    };
  }
  const db = {
    prepare,
    async batch(statements: any[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const stmt of statements) results.push(await stmt.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as SQL;
  sqlite
    .prepare("INSERT INTO users(id,username,password_hash) VALUES(1,?,?)")
    .run("perf_test", "unused");
  sqlite
    .prepare("INSERT INTO spaces(user_id,epoch,settings) VALUES(1,?,?)")
    .run(crypto.randomUUID(), JSON.stringify(settingsSchema.parse({})));
  sqlite
    .prepare("INSERT INTO vocabularies(id,user_id,name) VALUES(1,1,?)")
    .run("IELTS");
  return {
    sqlite,
    db,
    reset() {
      rows = 0;
      reads = 0;
    },
    metrics() {
      return { rows, reads };
    },
    close() {
      sqlite.close();
    },
  };
}
test("study next reads only the selected card, without loading 5040 words or writing a plan", async () => {
  const f = fixture();
  try {
    const catalog = JSON.parse(
      readFileSync(
        path.join(root, "apps/web/public/wordbooks/catalog.json"),
        "utf8",
      ),
    );
    const words = JSON.parse(
      readFileSync(path.join(root, "apps/web/public", catalog[0].file), "utf8"),
    );
    const card = createEmptyCard(),
      encoded = JSON.stringify(card);
    const insertWord = f.sqlite.prepare(
      "INSERT INTO words(user_id,word,zh) VALUES(1,?,?)",
    );
    const insertCard = f.sqlite.prepare(
      "INSERT INTO cards(user_id,word_id,json,due,epoch) VALUES(1,?,?,?,?)",
    );
    const link = f.sqlite.prepare(
      "INSERT INTO vocabulary_words(user_id,vocabulary_id,word_id) VALUES(1,1,?)",
    );
    f.sqlite.exec("BEGIN");
    for (const [word, zh] of words) {
      const id = Number(insertWord.run(word, zh).lastInsertRowid);
      insertCard.run(id, encoded, card.due.toISOString(), crypto.randomUUID());
      link.run(id);
    }
    f.sqlite.exec("COMMIT");
    const store = await new D1Store(f.db, 1).init();
    f.reset();
    const next = await store.next(1);
    assert.ok(next?.id);
    const measured = f.metrics();
    console.log(
      "next-card baseline:",
      JSON.stringify({ ...measured, pendingWrites: store.pending.length }),
    );
    assert.ok(
      measured.rows <= 4,
      `one card request transferred ${measured.rows} database rows`,
    );
    assert.ok(
      measured.reads <= 3,
      `one card request made ${measured.reads} sequential queries`,
    );
    assert.equal(
      store.pending.length,
      0,
      "reading next should not create a write transaction",
    );
  } finally {
    f.close();
  }
});

test("all four ratings commit progress atomically; retry cannot double-count and the new-card cap remains enforced", async () => {
  const f = fixture();
  try {
    const now = new Date(),
      card = createEmptyCard(now);
    for (let i = 0; i < 5; i++) {
      const id = Number(
        f.sqlite
          .prepare("INSERT INTO words(user_id,word,zh) VALUES(1,?,?)")
          .run("test " + String.fromCharCode(97 + i), "测试").lastInsertRowid,
      );
      f.sqlite
        .prepare(
          "INSERT INTO cards(user_id,word_id,json,due,epoch) VALUES(1,?,?,?,?)",
        )
        .run(
          id,
          JSON.stringify(card),
          card.due.toISOString(),
          crypto.randomUUID(),
        );
      f.sqlite.prepare("INSERT INTO vocabulary_words VALUES(1,1,?)").run(id);
    }
    for (const rating of [1, 2, 3, 4] as const) {
      const store = await new D1Store(f.db, 1).init(),
        next = await store.next(1, now);
      assert.ok(next);
      const input = {
        eventId: crypto.randomUUID(),
        wordId: next.id,
        version: next.version,
        epoch: next.epoch,
        rating,
        seconds: 10,
        mode: "card",
      };
      f.reset();
      const result = await store.review(input, now);
      assert.equal(
        f.metrics().reads,
        3,
        "rating should not aggregate speeds or all study sessions",
      );
      await store.commit();
      assert.equal(result.progress.newDone, rating);
      assert.equal(result.progress.cap, 80);
      assert.equal(
        f.sqlite
          .prepare("SELECT new_done FROM daily_plans WHERE user_id=1")
          .get()!.new_done,
        rating,
      );
      const retry = await new D1Store(f.db, 1).init();
      assert.deepEqual(
        await retry.review(input, now),
        JSON.parse(JSON.stringify(result)),
      );
      assert.equal(retry.pending.length, 0);
      assert.equal(
        f.sqlite.prepare("SELECT count(*) n FROM review_logs").get()!.n,
        rating,
      );
    }
    f.sqlite
      .prepare("UPDATE daily_plans SET new_done=80 WHERE user_id=1")
      .run();
    const capped = await new D1Store(f.db, 1).init();
    assert.equal(await capped.next(1, now), null);
    const fifth = f.sqlite
      .prepare("SELECT * FROM cards WHERE word_id=5")
      .get()!;
    await assert.rejects(
      capped.review(
        {
          eventId: crypto.randomUUID(),
          wordId: 5,
          version: 0,
          epoch: String(fifth.epoch),
          rating: 3,
          seconds: 10,
          mode: "card",
        },
        now,
      ),
      /今日新词已达上限/,
    );
    f.sqlite
      .prepare("UPDATE cards SET due=?,state=3 WHERE word_id=1")
      .run(new Date(now.getTime() - 1000).toISOString());
    assert.equal(
      (await capped.next(1, now))?.id,
      1,
      "due reviews remain available after cap",
    );
    assert.equal(
      await capped.next(999, now),
      null,
      "queue must respect vocabulary scope",
    );
  } finally {
    f.close();
  }
});
