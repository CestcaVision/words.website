import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../apps/api/store.ts";
import { applyEnrichment, parseEnrichment } from "../apps/api/enrichment.ts";
const fields = {
  zh: "有韧性的；能恢复的",
  pos: "adj. 形容词",
  example: "The community remained resilient.",
  translation: "这个社区依然坚韧。",
  usage:
    "用于描述面对困难能够恢复的人、组织或材料。常见搭配：remain resilient。",
  en: "Able to recover.",
  phonetic: "/rɪˈzɪliənt/",
};
test("structured AI output requires Chinese meaning, part of speech, bilingual example and usage", () => {
  assert.deepEqual(
    parseEnrichment("```json\n" + JSON.stringify(fields) + "\n```"),
    fields,
  );
  assert.throws(() => parseEnrichment(JSON.stringify({ ...fields, zh: "" })));
  assert.throws(() => parseEnrichment("an unstructured explanation"));
});
test("AI fill persists, preserves existing user content and does not change memory state", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vocabflow-enrichment-"));
  let s = new Store(dir);
  try {
    s.run("INSERT INTO vocabularies(name) VALUES(?)", "fixture");
    s.import(
      1,
      [
        {
          word: "resilient",
          notes: "my private note",
          pos: "user-defined adjective",
        },
      ],
      "fixture",
    );
    const before = s.one("SELECT * FROM cards WHERE word_id=1");
    const saved = applyEnrichment(s, 1, "resilient", fields, "fixture-model");
    assert.equal(saved.zh, fields.zh);
    assert.equal(saved.pos, "user-defined adjective");
    assert.equal(saved.notes, "my private note");
    assert.equal(saved.usage, fields.usage);
    assert.ok(JSON.parse(saved.ai_fields).includes("zh"));
    assert.ok(!JSON.parse(saved.ai_fields).includes("pos"));
    assert.deepEqual(s.one("SELECT * FROM cards WHERE word_id=1"), before);
    assert.throws(
      () => applyEnrichment(s, 1, "different-word", fields, "fixture-model"),
      /修改/,
    );
    applyEnrichment(
      s,
      1,
      "resilient",
      { ...fields, zh: "overwrite" },
      "fixture-model",
    );
    assert.equal(s.words()[0].zh, fields.zh);
    await s.backup(path.join(dir, "complete.sqlite"));
    s.close();
    s = new Store(dir);
    assert.equal(s.words()[0].usage, fields.usage);
    assert.equal(s.words()[0].translation, fields.translation);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
