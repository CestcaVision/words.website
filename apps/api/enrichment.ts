import { z } from "zod";
import type { Store } from "./store.ts";
export const enrichmentSchema = z.object({
  zh: z.string().trim().min(1).max(4000),
  pos: z.string().trim().min(1).max(100),
  example: z.string().trim().min(1).max(4000),
  translation: z.string().trim().min(1).max(4000),
  usage: z.string().trim().min(1).max(4000),
  en: z.string().max(4000).default(""),
  phonetic: z.string().max(300).default(""),
});
export function parseEnrichment(content: string) {
  return enrichmentSchema.parse(
    JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    ),
  );
}
export function applyEnrichment(
  store: Store,
  id: number,
  word: string,
  input: unknown,
  model: string,
) {
  const fields = enrichmentSchema.parse(input);
  return store.tx(() => {
    const current = store.one("SELECT * FROM words WHERE id=?", id);
    if (!current || current.word !== word)
      throw new Error("单词已修改或删除，请重新生成");
    const previous = store.one(
      "SELECT * FROM word_enrichments WHERE word_id=?",
      id,
    );
    const generated = new Set<string>(JSON.parse(previous?.fields || "[]"));
    const merged = { ...current };
    for (const key of [
      "zh",
      "pos",
      "example",
      "translation",
      "en",
      "phonetic",
    ] as const) {
      if (!String(current[key] || "").trim() && fields[key]) {
        merged[key] = fields[key];
        generated.add(key);
      }
    }
    const usage = previous?.usage?.trim() ? previous.usage : fields.usage;
    if (!previous?.usage?.trim()) generated.add("usage");
    store.run(
      "UPDATE words SET zh=?,pos=?,example=?,translation=?,en=?,phonetic=? WHERE id=?",
      merged.zh,
      merged.pos,
      merged.example,
      merged.translation,
      merged.en,
      merged.phonetic,
      id,
    );
    store.run(
      "INSERT INTO word_enrichments(word_id,usage,fields,model,generated_at) VALUES(?,?,?,?,?) ON CONFLICT(word_id) DO UPDATE SET usage=excluded.usage,fields=excluded.fields,model=excluded.model,generated_at=excluded.generated_at",
      id,
      usage,
      JSON.stringify([...generated]),
      model,
      new Date().toISOString(),
    );
    return { ...merged, usage, ai_fields: JSON.stringify([...generated]) };
  });
}
