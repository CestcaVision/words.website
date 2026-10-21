import { z } from "zod";
export const wordSchema = z.object({
  word: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[a-zA-Z][a-zA-Z '’.-]*$/),
  zh: z.string().max(4000).default(""),
  en: z.string().max(4000).default(""),
  phonetic: z.string().max(300).default(""),
  pos: z.string().max(100).default(""),
  example: z.string().max(4000).default(""),
  translation: z.string().max(4000).default(""),
  tags: z.string().max(1000).default(""),
  notes: z.string().max(4000).default(""),
});
export const settingsSchema = z.object({
  nickname: z.string().max(60).default(""),
  newGoal: z.number().int().min(1).max(200).default(20),
  minutes: z.number().int().min(1).max(600).default(30),
  timezone: z
    .string()
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    })
    .default("Asia/Shanghai"),
  retention: z.number().min(0.7).max(0.97).default(0.9),
  mode: z
    .enum(["card", "choice", "spelling", "listening", "difficult"])
    .default("card"),
  theme: z.enum(["light", "dark"]).default("light"),
  ai: z.boolean().default(false),
  firstDay: z.string().optional(),
  lastDay: z.string().optional(),
  lastAt: z.string().optional(),
});
export type Word = z.infer<typeof wordSchema>;
