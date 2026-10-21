import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { Store } from "../apps/api/store.ts";
import { readImport } from "../apps/api/importer.ts";
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "vocabflow-test-"));
  const s = new Store(dir);
  s.run("INSERT INTO vocabularies(name) VALUES(?)", "IELTS");
  return {
    s,
    dir,
    done: () => {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const word = (n: number) => ({
  word:
    "word" +
    n
      .toString(26)
      .split("")
      .map((c) => String.fromCharCode(97 + parseInt(c, 26)))
      .join(""),
  zh: "释义 " + n,
});
function review(
  s: Store,
  c: any,
  date: Date,
  rating = 3,
  eventId = randomUUID(),
) {
  return s.review(
    {
      eventId,
      wordId: c.id,
      version: c.version,
      rating: rating as any,
      seconds: 20,
      mode: "card",
    },
    date,
  );
}
test("3000 xlsx rows, CSV/TXT mapping, invalid and duplicate rows", async () => {
  const { s, done } = fixture();
  try {
    const wb = new ExcelJS.Workbook(),
      sheet = wb.addWorksheet("words");
    sheet.addRow(["英文单词", "中文释义"]);
    for (let i = 0; i < 3000; i++) sheet.addRow([word(i).word, word(i).zh]);
    const p = await readImport(
      Buffer.from(await wb.xlsx.writeBuffer()),
      "ielts.xlsx",
    );
    assert.equal(p.rows.length, 3000);
    assert.deepEqual(p.mapping, ["word", "zh"]);
    const rows = p.rows.map((r) => ({ word: r[0], zh: r[1] }));
    assert.equal(s.import(1, rows, "xlsx").success, 3000);
    const r = s.import(
      1,
      [rows[0], { word: "" }, { word: "123" }, rows[1]],
      "test",
    );
    assert.equal(r.skipped, 2);
    assert.equal(r.failed, 2);
    assert.equal(s.words().length, 3000);
    assert.deepEqual(
      (await readImport(Buffer.from("word,zh\nhello,你好\n"), "a.csv")).mapping,
      ["word", "zh"],
    );
    assert.equal(
      (await readImport(Buffer.from("hello\nworld"), "a.txt")).rows.length,
      2,
    );
  } finally {
    done();
  }
});
test("FSRS persistence, idempotency and stale browser tab conflict", () => {
  const { s, dir, done } = fixture();
  try {
    s.import(1, [word(1)], "test");
    const now = new Date("2026-10-21T02:00:00Z"),
      c = s.next(0, now),
      event = randomUUID();
    const r = review(s, c, now, 1, event);
    assert.equal(r.card.reps, 1);
    assert.ok(r.card.due instanceof Date);
    assert.equal(review(s, c, now, 1, event).version, 1);
    assert.equal(s.one("SELECT count(*) n FROM review_logs").n, 1);
    assert.throws(() => review(s, c, now), /标签页/);
    assert.throws(() => review(s, c, now, 3, event), /事件/);
    assert.equal(s.settings().firstDay, "2026-10-21");
    s.close();
    s.db = new Store(dir).db;
    assert.equal(s.words()[0].reps, 1);
    assert.equal(s.one("SELECT count(*) n FROM review_logs").n, 1);
  } finally {
    done();
  }
});
test("first learning date, global 80/200 cap, default 20, future date and rollback", () => {
  const { s, done } = fixture();
  try {
    s.import(
      1,
      Array.from({ length: 350 }, (_, i) => word(i)),
      "test",
    );
    assert.equal(s.settings().firstDay, undefined);
    assert.equal(s.settings().newGoal, 20);
    const now = new Date("2026-10-21T02:00:00Z");
    for (let i = 0; i < 80; i++) {
      const c = s.words().find((w) => !w.reps);
      review(s, c, now);
    }
    assert.equal(s.plan(now).newDone, 80);
    assert.throws(
      () =>
        review(
          s,
          s.words().find((w) => !w.reps),
          now,
        ),
      /上限/,
    );
    const tomorrow = new Date("2026-10-22T02:00:00Z");
    assert.equal(s.plan(tomorrow).cap, 200);
    s.saveSettings({ newGoal: 200 });
    for (let i = 0; i < 200; i++)
      review(
        s,
        s.words().find((w) => !w.reps),
        tomorrow,
      );
    assert.throws(
      () =>
        review(
          s,
          s.words().find((w) => !w.reps),
          tomorrow,
        ),
      /上限/,
    );
    assert.throws(
      () =>
        review(
          s,
          s.words().find((w) => !w.reps),
          now,
        ),
      /回拨/,
    );
    assert.equal(s.plan(now).day, "2026-10-22");
    assert.throws(() => s.saveSettings({ timezone: "UTC" }), /时区/);
  } finally {
    done();
  }
});
test("review priority, time soft target and retained overdue state", () => {
  const { s, done } = fixture();
  try {
    s.import(
      1,
      Array.from({ length: 10 }, (_, i) => word(i)),
      "test",
    );
    const now = new Date("2026-10-01T00:00:00Z");
    review(s, s.next(0, now), now, 1);
    const future = new Date("2026-10-20T00:00:00Z");
    const next = s.next(0, future);
    assert.ok(next.reps > 0);
    assert.equal(next.state, 1);
    s.saveSettings({ minutes: 1 });
    assert.ok(s.next(0, future));
    assert.equal(s.one("SELECT count(*) n FROM cards").n, 10);
    assert.equal(s.plan(future).cap, 200);
  } finally {
    done();
  }
});
test("cross-vocabulary shared state, migration preserves data, online WAL backup restores", async () => {
  const { s, dir, done } = fixture();
  try {
    s.import(1, [word(1)], "test");
    s.run("INSERT INTO vocabularies(name) VALUES(?)", "Reading");
    s.import(2, [word(1)], "test");
    assert.equal(s.words().length, 1);
    review(s, s.next(), new Date());
    s.saveSettings({ nickname: "Tester" });
    const backup = path.join(dir, "snapshot.sqlite");
    await s.backup(backup);
    const { DatabaseSync } = await import("node:sqlite");
    const copy = new DatabaseSync(backup);
    assert.equal(
      copy.prepare("PRAGMA integrity_check").get()?.integrity_check,
      "ok",
    );
    for (const table of [
      "words",
      "cards",
      "review_logs",
      "settings",
      "vocabulary_words",
    ])
      assert.deepEqual(
        copy.prepare(`SELECT * FROM ${table}`).all(),
        s.all(`SELECT * FROM ${table}`),
      );
    copy.close();
    s.close();
    const reopened = new Store(dir);
    s.db = reopened.db;
    assert.equal(s.settings().nickname, "Tester");
    assert.equal(s.words()[0].reps, 1);
    assert.equal(s.all("SELECT * FROM migrations").length, 3);
  } finally {
    done();
  }
});
