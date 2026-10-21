import { DatabaseSync, backup } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  existsSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyCard, fsrs, type Card, type Grade } from "ts-fsrs";
import { settingsSchema, wordSchema } from "../../packages/shared/schema.ts";
export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export class Store {
  db: DatabaseSync;
  dir: string;
  constructor(dir = path.resolve(root, process.env.DATA_DIR || "data")) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    const databaseFile = path.join(dir, "vocabflow.sqlite");
    if (!existsSync(databaseFile) && existsSync(databaseFile + ".previous"))
      renameSync(databaseFile + ".previous", databaseFile);
    this.db = new DatabaseSync(path.join(dir, "vocabflow.sqlite"));
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY)",
    );
    for (const name of readdirSync(
      path.join(root, "database/migrations"),
    ).sort()) {
      if (!this.one("SELECT * FROM migrations WHERE name=?", name))
        this.tx(() => {
          this.db.exec(
            readFileSync(path.join(root, "database/migrations", name), "utf8"),
          );
          this.run("INSERT INTO migrations VALUES(?)", name);
        });
    }
    if (!this.one("SELECT * FROM settings"))
      this.run(
        "INSERT INTO settings VALUES(1,?)",
        JSON.stringify(settingsSchema.parse({})),
      );
  }
  one(sql: string, ...args: any[]): any {
    return this.db.prepare(sql).get(...args);
  }
  all(sql: string, ...args: any[]): any[] {
    return this.db.prepare(sql).all(...args);
  }
  run(sql: string, ...args: any[]) {
    return this.db.prepare(sql).run(...args);
  }
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  settings() {
    return settingsSchema.parse(
      JSON.parse(this.one("SELECT json FROM settings").json),
    );
  }
  saveSettings(value: unknown) {
    const old = this.settings();
    const s = settingsSchema.parse({
      ...old,
      ...(value as any),
      firstDay: old.firstDay,
      lastDay: old.lastDay,
      lastAt: old.lastAt,
    });
    if (old.firstDay && s.timezone !== old.timezone)
      throw new Error("开始学习后学习时区已固定，以防重复发放新词");
    this.run("UPDATE settings SET json=?", JSON.stringify(s));
    return s;
  }
  day(now = new Date()) {
    const s = this.settings();
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: s.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    return s.lastDay && day < s.lastDay ? s.lastDay : day;
  }
  plan(now = new Date()) {
    const s = this.settings(),
      day = this.day(now);
    const n =
      this.one("SELECT new_done n FROM daily_plans WHERE day=?", day)?.n || 0;
    const first = !s.firstDay || s.firstDay === day;
    const cap = first ? 80 : 200;
    const due = this.one(
      "SELECT count(*) n FROM cards WHERE reps>0 AND due<=?",
      now.toISOString(),
    ).n;
    const speeds = this.all(
      "SELECT is_new,avg(seconds) sec FROM review_logs WHERE seconds>0 GROUP BY is_new",
    );
    const speed = (isNew: number, def: number) =>
      Math.max(5, speeds.find((x) => x.is_new === isNew)?.sec || def);
    const recommended = Math.max(
      0,
      Math.min(
        s.newGoal - n,
        cap - n,
        Math.floor(
          (s.minutes * 60 * 0.9 -
            this.one(
              "SELECT coalesce(sum(seconds),0) seconds FROM study_sessions WHERE day=?",
              day,
            ).seconds -
            due * speed(0, 20)) /
            speed(1, 45),
        ),
      ),
    );
    this.run(
      "INSERT INTO daily_plans(day,new_goal,review_goal) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET new_goal=excluded.new_goal,review_goal=max(daily_plans.review_goal,excluded.review_goal)",
      day,
      Math.min(s.newGoal, cap),
      due,
    );
    return {
      day,
      cap,
      newDone: n,
      due,
      recommended,
      goal: Math.min(s.newGoal, cap),
      saved: this.one("SELECT * FROM daily_plans WHERE day=?", day),
    };
  }
  words(vocab?: number, q = "", filter = "") {
    return this.all(
      `SELECT w.*,coalesce(e.usage,'') usage,coalesce(e.fields,'[]') ai_fields,c.json card,c.version,c.reps,c.lapses,c.due,c.state FROM words w JOIN cards c ON c.word_id=w.id LEFT JOIN word_enrichments e ON e.word_id=w.id WHERE (?=0 OR EXISTS(SELECT 1 FROM vocabulary_words v WHERE v.word_id=w.id AND v.vocabulary_id=?)) AND (w.word LIKE ? OR w.zh LIKE ?) ${filter === "new" ? "AND c.reps=0" : filter === "difficult" ? "AND (c.lapses>0 OR EXISTS(SELECT 1 FROM review_logs r WHERE r.word_id=w.id AND (r.rating=1 OR r.answer_correct=0)))" : filter === "due" ? "AND c.reps>0 AND c.due<=strftime('%Y-%m-%dT%H:%M:%fZ','now')" : ""} ORDER BY w.id`,
      vocab || 0,
      vocab || 0,
      `%${q}%`,
      `%${q}%`,
    );
  }
  vocabularies() {
    return this.all(
      "SELECT v.*,count(w.word_id) total,sum(CASE WHEN c.reps>0 THEN 1 ELSE 0 END) learned,sum(CASE WHEN c.reps>0 AND c.due<=? THEN 1 ELSE 0 END) due,sum(CASE WHEN c.reps>=5 AND c.lapses=0 THEN 1 ELSE 0 END) mastered FROM vocabularies v LEFT JOIN vocabulary_words w ON w.vocabulary_id=v.id LEFT JOIN cards c ON c.word_id=w.word_id GROUP BY v.id",
      new Date().toISOString(),
    );
  }
  import(vocab: number, rows: unknown[], filename: string) {
    if (!this.one("SELECT id FROM vocabularies WHERE id=?", vocab))
      throw new Error("目标词库不存在");
    const findWord = this.db.prepare(
      "SELECT id FROM words WHERE word=? COLLATE NOCASE",
    );
    const insertWord = this.db.prepare(
      "INSERT INTO words(word,zh,en,phonetic,pos,example,translation,tags,notes) VALUES(?,?,?,?,?,?,?,?,?)",
    );
    const insertCard = this.db.prepare(
      "INSERT INTO cards(word_id,json,due) VALUES(?,?,?)",
    );
    const findLink = this.db.prepare(
      "SELECT 1 FROM vocabulary_words WHERE vocabulary_id=? AND word_id=?",
    );
    const insertLink = this.db.prepare(
      "INSERT INTO vocabulary_words VALUES(?,?)",
    );
    return this.tx(() => {
      let success = 0,
        skipped = 0;
      const errors: { row: number; reason: string }[] = [];
      rows.forEach((raw, i) => {
        const parsed = wordSchema.safeParse(raw);
        if (!parsed.success) {
          errors.push({
            row: i + 1,
            reason: parsed.error.issues
              .map((x) => x.path + ": " + x.message)
              .join("; "),
          });
          return;
        }
        const w = parsed.data;
        let existing = findWord.get(w.word) as { id: number } | undefined;
        if (!existing) {
          const result = insertWord.run(...Object.values(w));
          existing = { id: Number(result.lastInsertRowid) };
          const c = createEmptyCard();
          insertCard.run(existing.id, JSON.stringify(c), c.due.toISOString());
        }
        if (findLink.get(vocab, existing.id)) {
          skipped++;
          return;
        }
        insertLink.run(vocab, existing.id);
        success++;
      });
      const result = { success, skipped, failed: errors.length, errors };
      this.run(
        "INSERT INTO import_logs(at,filename,json) VALUES(?,?,?)",
        new Date().toISOString(),
        filename,
        JSON.stringify(result),
      );
      return result;
    });
  }
  next(vocab = 0, now = new Date()) {
    const p = this.plan(now);
    const words = this.words(vocab);
    const due = words
      .filter((x) => x.reps > 0 && x.due <= now.toISOString())
      .sort(
        (a, b) =>
          (a.state === 3 ? 0 : 1) - (b.state === 3 ? 0 : 1) ||
          a.due.localeCompare(b.due),
      );
    return (
      due[0] || (p.newDone < p.cap ? words.find((x) => !x.reps) : null) || null
    );
  }
  review(
    input: {
      eventId: string;
      wordId: number;
      version: number;
      rating: Grade;
      seconds: number;
      mode: string;
      correct?: boolean | null;
    },
    now = new Date(),
  ) {
    return this.tx(() => {
      const prior = this.one(
        "SELECT result,word_id,rating FROM review_logs WHERE event_id=?",
        input.eventId,
      );
      if (prior) {
        if (prior.word_id !== input.wordId || prior.rating !== input.rating)
          throw new Error("事件 ID 已被其他提交使用");
        return JSON.parse(prior.result);
      }
      const row = this.one("SELECT * FROM cards WHERE word_id=?", input.wordId);
      if (!row) throw new Error("单词不存在");
      if (row.version !== input.version)
        throw new Error("卡片已在其他标签页更新，请重新加载");
      const s = this.settings();
      if (s.lastAt && now.getTime() < Date.parse(s.lastAt))
        throw new Error("检测到时间回拨，请校正系统时间后学习");
      const p = this.plan(now);
      if (!row.reps && p.newDone >= p.cap)
        throw new Error("今日新词已达上限，仍可继续复习");
      if (row.reps && row.due > now.toISOString())
        throw new Error("此卡片尚未到期；额外练习不提交正式复习");
      const c = JSON.parse(row.json) as Card;
      c.due = new Date(c.due);
      if (c.last_review) c.last_review = new Date(c.last_review);
      const result = fsrs({ request_retention: s.retention }).next(
        c,
        now,
        input.rating,
      );
      const v = row.version + 1;
      this.run(
        "UPDATE cards SET json=?,version=?,due=?,reps=?,lapses=?,state=? WHERE word_id=?",
        JSON.stringify(result.card),
        v,
        result.card.due.toISOString(),
        result.card.reps,
        result.card.lapses,
        result.card.state,
        input.wordId,
      );
      if (!row.reps)
        this.run(
          "UPDATE daily_plans SET new_done=new_done+1 WHERE day=?",
          p.day,
        );
      const out = { ...result, version: v };
      const secs = Math.max(0, Math.min(120, Math.round(input.seconds)));
      this.run(
        "INSERT INTO review_logs(event_id,word_id,day,at,rating,is_new,seconds,mode,log,result,answer_correct) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        input.eventId,
        input.wordId,
        p.day,
        now.toISOString(),
        input.rating,
        row.reps === 0 ? 1 : 0,
        secs,
        input.mode,
        JSON.stringify(result.log),
        JSON.stringify(out),
        input.correct == null ? null : Number(input.correct),
      );
      this.run(
        "INSERT INTO study_sessions VALUES(?,?,?)",
        input.eventId,
        p.day,
        secs,
      );
      this.run(
        "UPDATE settings SET json=?",
        JSON.stringify({
          ...s,
          firstDay: s.firstDay || p.day,
          lastDay: p.day,
          lastAt: now.toISOString(),
        }),
      );
      return out;
    });
  }
  stats() {
    const p = this.plan();
    const today = this.one(
      "SELECT count(*) answers,count(DISTINCT word_id) distinctWords,coalesce(sum(is_new),0) newWords,coalesce(sum(CASE WHEN is_new=0 THEN 1 ELSE 0 END),0) reviews,coalesce(sum(seconds),0) seconds FROM review_logs WHERE day=?",
      p.day,
    );
    const counts = this.one(
      "SELECT count(*) total,coalesce(sum(reps>0),0) learned FROM cards",
    );
    const recent = this.one(
      "SELECT avg(rating>1)*100 accuracy FROM (SELECT rating FROM review_logs ORDER BY at DESC LIMIT 100)",
    );
    const calendar = this.all(
      "SELECT day,count(*) count FROM review_logs GROUP BY day ORDER BY day",
    );
    let streak = 0;
    let d = new Date(p.day + "T12:00:00Z");
    const days = new Set(calendar.map((x) => x.day));
    if (!days.has(p.day)) d.setUTCDate(d.getUTCDate() - 1);
    while (days.has(d.toISOString().slice(0, 10))) {
      streak++;
      d.setUTCDate(d.getUTCDate() - 1);
    }
    const forecast = this.all(
      "SELECT substr(due,1,10) day,count(*) count FROM cards WHERE reps>0 AND due>? GROUP BY substr(due,1,10) ORDER BY day LIMIT 14",
      new Date().toISOString(),
    );
    return {
      plan: p,
      today,
      counts,
      difficult: this.words(0, "", "difficult").length,
      answerAccuracy: this.one(
        "SELECT avg(answer_correct)*100 accuracy FROM (SELECT answer_correct FROM review_logs WHERE answer_correct IS NOT NULL ORDER BY at DESC LIMIT 100)",
      ).accuracy,
      accuracy: recent.accuracy || 0,
      calendar,
      streak,
      forecast,
      completion: Math.min(
        100,
        Math.round(
          ((today.newWords + today.reviews) /
            Math.max(1, p.saved.new_goal + p.saved.review_goal)) *
            100,
        ),
      ),
    };
  }
  async backup(destination: string) {
    await backup(this.db, destination);
  }
  close() {
    this.db.close();
  }
}
