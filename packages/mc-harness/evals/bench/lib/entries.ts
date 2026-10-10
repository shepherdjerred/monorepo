/**
 * Bench storage. Everything a leaderboard needs lives in the repository
 * under `evals/bench/`: one directory per judged build (an "entry") with its
 * metadata, absolute scores and a small JPEG of its judge sheet, plus the
 * tournaments that rated them. Schematics are large and stay out of the
 * repository (`~/.toolkit/mc/bench/`), identified by sha256 in the metadata.
 */
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { JudgeRubricSchema } from "#protocol/build.ts";
import { rubricAxisIds } from "#build/judge.ts";

export const BENCH_DIR = path.resolve(import.meta.dir, "..");
export const BENCH_HOME = path.join(os.homedir(), ".toolkit", "mc", "bench");

export const BENCH_FILES = {
  history: "history",
  anchors: "anchors",
  leaderboard: path.join("history", "LEADERBOARD.md"),
  index: path.join("history", "index.json"),
  meta: "meta.json",
  scores: "scores.json",
  sheet: "sheet.jpg",
  tournaments: "tournaments",
  pairCache: "pair-cache.json",
} as const;

const Vec3Schema = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});

export const UsageSchema = z.strictObject({
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number().optional(),
});

export const EntryMetaSchema = z.strictObject({
  /** `<head10>-<agent>-<runId>` for eval runs; `anchor-<slug>` for anchors. */
  id: z.string().min(1),
  task: z.string().min(1),
  rubric: JudgeRubricSchema,
  anchor: z.boolean(),
  /** An anchor that is not a professional build (library render) — ratings against it are relative only. */
  weak: z.boolean(),
  head: z.string(),
  agent: z.string().nullable(),
  model: z.string().nullable(),
  runId: z.string().nullable(),
  collectedAt: z.string().min(1),
  /** Anchors: where the build came from and under which licence. */
  source: z.string().nullable(),
  licence: z.string().nullable(),
  seconds: z.number().nullable(),
  usage: UsageSchema.nullable(),
  checks: z.strictObject({ passed: z.number().int(), total: z.number().int() }),
  lint: z.strictObject({
    errors: z.number().int(),
    warnings: z.number().int(),
    codes: z.array(z.string()),
  }),
  gridHash: z.string().min(1),
  size: Vec3Schema,
  blocks: z.number().int(),
  /** `repetitionRatio` of the promoted grid. */
  repetition: z.number(),
  schematic: z
    .strictObject({ path: z.string().min(1), sha256: z.string().min(1) })
    .nullable(),
  /** From the build's journal (eval runs only): renders, critique totals, knockout outcomes. */
  trajectory: z
    .strictObject({
      iterations: z.number().int(),
      critiques: z.array(z.number().int()),
      accepted: z.number().int(),
      rejected: z.number().int(),
    })
    .optional(),
});
export type EntryMeta = z.infer<typeof EntryMetaSchema>;

/** One absolute score of an entry's sheet by one judge (model + prompt/schema fingerprint). */
export const ScoreRecordSchema = z
  .strictObject({
    at: z.string().min(1),
    model: z.string().min(1),
    /** `scoreFingerprint(rubric)` when the score was taken; a changed prompt is a new judge. */
    judge: z.string().min(1),
    rubric: JudgeRubricSchema,
    sheetSha256: z.string().min(1),
    /** Exactly the rubric's axes: a record missing one is corrupt, not a zero. */
    axes: z.record(z.string(), z.number().int().min(0).max(5)),
    overallAesthetic: z.number().int().min(0).max(5),
    total: z.number().int(),
    max: z.number().int(),
    notes: z.array(z.string()),
  })
  .superRefine((record, ctx) => {
    const expected = rubricAxisIds(record.rubric);
    const given = Object.keys(record.axes);
    const missing = expected.filter((id) => !given.includes(id));
    const unknown = given.filter((id) => !expected.includes(id));
    if (missing.length > 0 || unknown.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["axes"],
        message: `score record for ${record.rubric} must have exactly its axes${missing.length === 0 ? "" : `; missing ${missing.join(", ")}`}${unknown.length === 0 ? "" : `; unknown ${unknown.join(", ")}`}`,
      });
      return;
    }
    // The summary is derived from the axes; a disagreeing one is corrupt history.
    const total = expected.reduce((sum, id) => sum + (record.axes[id] ?? 0), 0);
    if (record.total !== total) {
      ctx.addIssue({
        code: "custom",
        path: ["total"],
        message: `score record total ${record.total.toString()} is not the sum of its axes (${total.toString()})`,
      });
    }
    if (record.max !== 5 * expected.length) {
      ctx.addIssue({
        code: "custom",
        path: ["max"],
        message: `score record max ${record.max.toString()} is not 5 × ${expected.length.toString()} axes`,
      });
    }
  });
export type ScoreRecord = z.infer<typeof ScoreRecordSchema>;

/**
 * `scores.json`: every judge's score of the entry, kept side by side so
 * judging one task with another model never overwrites the scores a shared
 * anchor shows on a different task's board.
 */
export const ScoresFileSchema = z.array(ScoreRecordSchema);
export type ScoresFile = z.infer<typeof ScoresFileSchema>;

/** The entry's score by one judge, or null when that judge has not scored it. */
export function scoreBy(
  scores: readonly ScoreRecord[],
  judge: { model: string; judge: string },
): ScoreRecord | null {
  return (
    scores.find(
      (record) => record.model === judge.model && record.judge === judge.judge,
    ) ?? null
  );
}

export const PairOutcomeSchema = z.strictObject({
  a: z.string().min(1),
  b: z.string().min(1),
  winner: z.enum(["a", "b", "tie"]),
  confidence: z.number(),
  agreed: z.boolean(),
  reasons: z.array(z.string()),
});
export type PairOutcome = z.infer<typeof PairOutcomeSchema>;

/** Keyed by `<rubric>|<judge fingerprint>|<model>|<sha a>|<sha b>` with the shas in sorted order. */
export const PairCacheSchema = z.record(
  z.string(),
  z.strictObject({
    winner: z.enum(["a", "b", "tie"]),
    confidence: z.number(),
    agreed: z.boolean(),
    reasons: z.array(z.string()),
    at: z.string(),
  }),
);
export type PairCache = z.infer<typeof PairCacheSchema>;

export const RatingSchema = z.strictObject({
  rating: z.number(),
  lo: z.number(),
  hi: z.number(),
  games: z.number(),
  wins: z.number(),
});

export const TournamentFileSchema = z.strictObject({
  at: z.string().min(1),
  task: z.string().min(1),
  rubric: JudgeRubricSchema,
  model: z.string().min(1),
  /** `judgeFingerprint(rubric)` when the pairs were judged; a changed prompt is a new judge. */
  judge: z.string().min(1),
  entries: z.array(z.string()),
  anchors: z.array(z.string()),
  /** Each contestant's sheet hash when it was judged; a rating is only for that sheet. */
  sheets: z.record(z.string(), z.string()),
  pairs: z.array(PairOutcomeSchema),
  ratings: z.record(z.string(), RatingSchema),
});
export type TournamentFile = z.infer<typeof TournamentFileSchema>;

export type Entry = {
  meta: EntryMeta;
  dir: string;
  sheet: string;
  /** Hash of `sheet.jpg` as it is now; ratings and scores taken of another sheet do not apply. */
  sheetSha256: string;
  scores: ScoresFile;
};

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function entryId(head: string, agent: string, runId: string): string {
  return `${head.slice(0, 10)}-${agent}-${runId}`;
}

export function taskHistoryDir(task: string, benchDir = BENCH_DIR): string {
  return path.join(benchDir, BENCH_FILES.history, task);
}

async function readJson<T>(
  file: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  return (await Bun.file(file).exists())
    ? schema.parse(JSON.parse(await Bun.file(file).text()))
    : null;
}

export async function readEntry(dir: string): Promise<Entry | null> {
  const meta = await readJson(
    path.join(dir, BENCH_FILES.meta),
    EntryMetaSchema,
  );
  if (meta === null) {
    return null;
  }
  // The sheet is the evidence every rating and score is taken of: metadata
  // without it is a broken entry, never history.
  const sheet = path.join(dir, BENCH_FILES.sheet);
  if (!(await Bun.file(sheet).exists())) {
    throw new Error(
      `${dir} has ${BENCH_FILES.meta} but no ${BENCH_FILES.sheet}; re-collect the entry or remove it`,
    );
  }
  return {
    meta,
    dir,
    sheet,
    sheetSha256: sha256(new Uint8Array(await Bun.file(sheet).arrayBuffer())),
    scores:
      (await readJson(path.join(dir, BENCH_FILES.scores), ScoresFileSchema)) ??
      [],
  };
}

async function entriesUnder(dir: string): Promise<Entry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries: Entry[] = [];
  for (const name of names.toSorted()) {
    const child = path.join(dir, name);
    const info = await stat(child);
    if (!info.isDirectory()) continue;
    const entry = await readEntry(child);
    if (entry !== null) entries.push(entry);
  }
  return entries;
}

/** A task's collected builds plus every anchor that uses the task's rubric. */
export async function listEntries(
  task: string,
  rubric: EntryMeta["rubric"],
  benchDir = BENCH_DIR,
): Promise<Entry[]> {
  const history = await entriesUnder(taskHistoryDir(task, benchDir));
  const allAnchors = await entriesUnder(
    path.join(benchDir, BENCH_FILES.anchors),
  );
  const anchors = allAnchors.filter(
    (entry) => entry.meta.anchor && entry.meta.rubric === rubric,
  );
  return [...anchors, ...history.filter((entry) => !entry.meta.anchor)];
}

/** Tasks that have history or anchors, from the directories present. */
export async function listTasks(benchDir = BENCH_DIR): Promise<string[]> {
  try {
    const names = await readdir(path.join(benchDir, BENCH_FILES.history));
    const tasks: string[] = [];
    for (const name of names.toSorted()) {
      const child = path.join(benchDir, BENCH_FILES.history, name);
      const info = await stat(child);
      if (info.isDirectory()) tasks.push(name);
    }
    return tasks;
  } catch {
    return [];
  }
}

export async function latestTournament(
  task: string,
  benchDir = BENCH_DIR,
): Promise<TournamentFile | null> {
  const dir = path.join(
    taskHistoryDir(task, benchDir),
    BENCH_FILES.tournaments,
  );
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const latest = names
    .filter((name) => name.endsWith(".json"))
    .toSorted()
    .at(-1);
  return latest === undefined
    ? null
    : readJson(path.join(dir, latest), TournamentFileSchema);
}
