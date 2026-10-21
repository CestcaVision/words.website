import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../apps/web/src/api.ts";
test("a hanging request rejects with actionable timeout instead of waiting forever", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      ),
    );
  try {
    await assert.rejects(
      api("/import", {}, "POST", 20),
      /请求超时.*导入可能已完成/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("validation errors propagate for the import screen to stop waiting", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "必须匹配英文单词" }), {
      status: 400,
    });
  try {
    await assert.rejects(api("/import", {}), /必须匹配英文单词/);
  } finally {
    globalThis.fetch = original;
  }
});
