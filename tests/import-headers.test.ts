import { test } from "node:test";
import assert from "node:assert/strict";
import { readImport } from "../apps/api/importer.ts";
test("recognize phrase and usage headers from vocabulary exports", async () => {
  const p = await readImport(
    Buffer.from(
      "单词或短语,词性,释义或用法,备注,来源工作表,原表行号\nhello,n.,你好,,,1",
    ),
    "fixture.csv",
  );
  assert.deepEqual(p.mapping, ["word", "pos", "zh", "notes", "", ""]);
});
