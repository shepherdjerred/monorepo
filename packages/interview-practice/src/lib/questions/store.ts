import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LeetcodeQuestionSchema } from "./schemas.ts";
import type { LeetcodeQuestion } from "./schemas.ts";
import type { Logger } from "#logger";

export type QuestionFilter = {
  difficulty?: "easy" | "medium" | "hard" | undefined;
  tags?: string[] | undefined;
  slug?: string | undefined;
}

export type QuestionStore = {
  getAll: () => LeetcodeQuestion[];
  getById: (id: string) => LeetcodeQuestion | undefined;
  getBySlug: (slug: string) => LeetcodeQuestion | undefined;
  filter: (filter: QuestionFilter) => LeetcodeQuestion[];
  getRandom: (filter?: QuestionFilter) => LeetcodeQuestion | undefined;
}

export function loadQuestionStore(
  questionsDir: string,
  logger: Logger,
): QuestionStore {
  const questions: LeetcodeQuestion[] = [];

  try {
    const files = readdirSync(questionsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = readFileSync(join(questionsDir, file), "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        const result = LeetcodeQuestionSchema.safeParse(parsed);
        if (result.success) {
          questions.push(result.data);
        } else {
          logger.warn("question_validation_failed", {
            file,
            errors: result.error.issues.map((i) => i.message),
          });
        }
      } catch (error) {
        logger.error("question_load_error", {
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch {
    logger.warn("questions_dir_missing", { dir: questionsDir });
  }

  logger.info("questions_loaded", { count: questions.length });

  function matchesFilter(
    q: LeetcodeQuestion,
    f: QuestionFilter,
  ): boolean {
    if (f.difficulty && q.difficulty !== f.difficulty) return false;
    if (f.tags && !f.tags.some((t) => q.tags.includes(t))) return false;
    if (f.slug && q.slug !== f.slug) return false;
    return true;
  }

  return {
    getAll: () => questions,
    getById: (id) => questions.find((q) => q.id === id),
    getBySlug: (slug) => questions.find((q) => q.slug === slug),
    filter: (f) => questions.filter((q) => matchesFilter(q, f)),
    getRandom(f) {
      const pool = f ? questions.filter((q) => matchesFilter(q, f)) : questions;
      if (pool.length === 0) return;
      const idx = Math.floor(Math.random() * pool.length);
      return pool[idx];
    },
  };
}
