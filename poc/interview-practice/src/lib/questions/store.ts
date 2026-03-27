import path from "node:path";
import {
  LeetcodeQuestionSchema,
  SystemDesignQuestionSchema,
} from "./schemas.ts";
import type {
  LeetcodeQuestion,
  SystemDesignQuestion,
  SystemDesignDifficulty,
} from "./schemas.ts";
import type { Logger } from "#logger";

export type QuestionFilter = {
  difficulty?: "easy" | "medium" | "hard" | undefined;
  tags?: string[] | undefined;
  slug?: string | undefined;
};

export type QuestionStore = {
  getAll: () => LeetcodeQuestion[];
  getById: (id: string) => LeetcodeQuestion | undefined;
  getBySlug: (slug: string) => LeetcodeQuestion | undefined;
  filter: (filter: QuestionFilter) => LeetcodeQuestion[];
  getRandom: (filter?: QuestionFilter) => LeetcodeQuestion | undefined;
};

function matchesFilter(q: LeetcodeQuestion, f: QuestionFilter): boolean {
  if (f.difficulty && q.difficulty !== f.difficulty) return false;
  if (f.tags && !f.tags.some((t) => q.tags.includes(t))) return false;
  if (f.slug !== undefined && f.slug !== "" && q.slug !== f.slug) return false;
  return true;
}

export async function loadQuestionStore(
  questionsDir: string,
  logger: Logger,
): Promise<QuestionStore> {
  const questions: LeetcodeQuestion[] = [];

  try {
    const glob = new Bun.Glob("*.json");
    const files = [...glob.scanSync(questionsDir)];
    for (const file of files) {
      try {
        const bunFile = Bun.file(path.join(questionsDir, file));
        const raw: string = await bunFile.text();
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

// System Design Question Store

export type SystemDesignQuestionFilter = {
  difficulty?: SystemDesignDifficulty | undefined;
  category?: string | undefined;
  slug?: string | undefined;
};

export type SystemDesignQuestionStore = {
  getAll: () => SystemDesignQuestion[];
  getById: (id: string) => SystemDesignQuestion | undefined;
  getBySlug: (slug: string) => SystemDesignQuestion | undefined;
  filter: (filter: SystemDesignQuestionFilter) => SystemDesignQuestion[];
  getRandom: (
    filter?: SystemDesignQuestionFilter,
  ) => SystemDesignQuestion | undefined;
};

function matchesSystemDesignFilter(
  q: SystemDesignQuestion,
  f: SystemDesignQuestionFilter,
): boolean {
  if (f.difficulty !== undefined && q.difficulty !== f.difficulty) return false;
  if (
    f.category !== undefined &&
    f.category !== "" &&
    q.category !== f.category
  )
    return false;
  if (f.slug !== undefined && f.slug !== "" && q.slug !== f.slug) return false;
  return true;
}

export async function loadSystemDesignQuestionStore(
  questionsDir: string,
  logger: Logger,
): Promise<SystemDesignQuestionStore> {
  const questions: SystemDesignQuestion[] = [];

  try {
    const glob = new Bun.Glob("*.json");
    const files = [...glob.scanSync(questionsDir)];
    for (const file of files) {
      try {
        const bunFile = Bun.file(path.join(questionsDir, file));
        const raw: string = await bunFile.text();
        const parsed = JSON.parse(raw) as unknown;
        const result = SystemDesignQuestionSchema.safeParse(parsed);
        if (result.success) {
          questions.push(result.data);
        } else {
          logger.warn("sd_question_validation_failed", {
            file,
            errors: result.error.issues.map((i) => i.message),
          });
        }
      } catch (error) {
        logger.error("sd_question_load_error", {
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch {
    logger.warn("sd_questions_dir_missing", { dir: questionsDir });
  }

  logger.info("sd_questions_loaded", { count: questions.length });

  return {
    getAll: () => questions,
    getById: (id) => questions.find((q) => q.id === id),
    getBySlug: (slug) => questions.find((q) => q.slug === slug),
    filter: (f) => questions.filter((q) => matchesSystemDesignFilter(q, f)),
    getRandom(f) {
      const pool = f
        ? questions.filter((q) => matchesSystemDesignFilter(q, f))
        : questions;
      if (pool.length === 0) return;
      const idx = Math.floor(Math.random() * pool.length);
      return pool[idx];
    },
  };
}
