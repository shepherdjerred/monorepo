/**
 * Build workspaces: a directory holding `build.json` (the manifest), an
 * ordered, replayable op log (`build.oplog.json`), the captured site, and
 * pasted schematics. Every op carries explicit coordinates, so the log replays
 * identically on a canvas, a fresh sandbox, or (later) live.
 */
import path from "node:path";
import { z } from "zod";
import {
  BlockPosSchema,
  BoxSchema,
  RotationSchema,
  SessionNameSchema,
} from "./bridge.ts";

export const BUILD_FILES = {
  manifest: "build.json",
  oplog: "build.oplog.json",
  program: "build.ts",
  siteDir: "site",
  siteSchematic: path.join("site", "site.schem"),
  siteInfo: path.join("site", "site.json"),
  expected: "expected.json",
  /** Frozen canvas result (bridge snapshot of the site box); promote pastes it. */
  expectedSchematic: "expected.schem",
  /** Tiled snapshots of map-scale sites: `<dir>/parts.json` + `<n>.schem`. */
  siteParts: path.join("site", "parts"),
  expectedParts: "expected-parts",
  schematicsDir: "schematics",
  rendersDir: "renders",
  /** Persisted judge verdicts: `judge/pair-<ts>.json`, `judge/absolute-<ts>.json`. */
  judgeDir: "judge",
  /** Append-only record of what happened to the build, one JSON entry per line. */
  journal: "journal.jsonl",
  /** The agent's own observations, read back as observations, not instructions. */
  notes: "notes.md",
  /** Saved versions of the program and op log: `candidates/<name>/`. */
  candidatesDir: "candidates",
  /** A throwaway pad beside the site for trying a wall or a roof. */
  scratchDir: "scratch",
} as const;

const Iso = z.string().min(1);
const Iteration = z.number().int().min(0);

export const JudgeRubricSchema = z.enum(["micro", "map"]);
export type JudgeRubric = z.infer<typeof JudgeRubricSchema>;

/** One line of `journal.jsonl`: what happened, when, in which iteration. */
export const BuildLogEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("capture"),
    at: Iso,
    iteration: Iteration,
    siteHash: z.string().min(1),
    box: BoxSchema,
  }),
  z.strictObject({
    kind: z.literal("note"),
    at: Iso,
    iteration: Iteration,
    text: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("compile"),
    at: Iso,
    iteration: Iteration,
    program: z.string(),
    ops: z.number().int(),
    lintErrors: z.number().int(),
    lintWarnings: z.number().int(),
  }),
  z.strictObject({
    kind: z.literal("run"),
    at: Iso,
    iteration: Iteration,
    target: z.string(),
    ops: z.number().int(),
    /** The program snapshot every op that ran came from, or null when the log mixed sources. */
    program: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("render"),
    at: Iso,
    iteration: Iteration,
    name: z.string(),
    source: z.string(),
    files: z.array(z.string()),
  }),
  z.strictObject({
    kind: z.literal("lint"),
    at: Iso,
    iteration: Iteration,
    source: z.string(),
    errors: z.number().int(),
    warnings: z.number().int(),
  }),
  z.strictObject({
    kind: z.literal("critique"),
    at: Iso,
    iteration: Iteration,
    render: z.string(),
    /** The grid that was critiqued; a render name can be reused, a hash cannot. */
    gridHash: z.string(),
    /** The rubric the total is on; totals of different rubrics never compare. */
    rubric: JudgeRubricSchema,
    file: z.string(),
    total: z.number().int(),
    max: z.number().int(),
    lowest: z.string(),
  }),
  z.strictObject({
    kind: z.literal("judge"),
    at: Iso,
    iteration: Iteration,
    file: z.string(),
    winner: z.string(),
    confidence: z.number(),
  }),
  z.strictObject({
    kind: z.literal("candidate"),
    at: Iso,
    iteration: Iteration,
    action: z.enum(["save", "pick"]),
    name: z.string(),
  }),
  z.strictObject({
    kind: z.literal("accept"),
    at: Iso,
    iteration: Iteration,
    candidate: z.string(),
    versus: z.string().nullable(),
    file: z.string().nullable(),
    /** The rubric the knockout ran on; `score` is a total on it. */
    rubric: JudgeRubricSchema,
    /** The accepted candidate's latest critique total on `rubric`, when its grid was critiqued on it. */
    score: z.number().int().nullable(),
  }),
  z.strictObject({
    kind: z.literal("reject"),
    at: Iso,
    iteration: Iteration,
    candidate: z.string(),
    versus: z.string(),
    file: z.string().nullable(),
    rubric: JudgeRubricSchema,
    score: z.number().int().nullable(),
  }),
  z.strictObject({
    kind: z.literal("promote"),
    at: Iso,
    iteration: Iteration,
    target: z.string(),
    applyId: z.string(),
  }),
  z.strictObject({ kind: z.literal("resume"), at: Iso, iteration: Iteration }),
]);
export type BuildLogEntry = z.infer<typeof BuildLogEntrySchema>;

/** `renders/<name>.json`: what a render was of and what the checks said about it. */
export const RenderSidecarSchema = z.strictObject({
  name: z.string().min(1),
  at: Iso,
  iteration: Iteration,
  source: z.string(),
  files: z.record(z.string(), z.string()),
  gridHash: z.string(),
  size: BlockPosSchema,
  /** World box the grid covers (a region render covers part of the site); set by `build render`. */
  box: z.strictObject({ min: BlockPosSchema, max: BlockPosSchema }).optional(),
  blocks: z.number().int(),
  /** The program that produced this render, copied beside it (`renders/<name>.build.ts`), or null. */
  program: z.string().nullable(),
  lint: z.strictObject({
    errors: z.number().int(),
    warnings: z.number().int(),
    codes: z.array(z.string()),
  }),
  /** Filled by `build critique`. */
  scores: z
    .strictObject({
      rubric: z.enum(["micro", "map"]),
      total: z.number().int(),
      max: z.number().int(),
      axes: z.record(z.string(), z.number().int()),
      overallAesthetic: z.number().int(),
    })
    .optional(),
});
export type RenderSidecar = z.infer<typeof RenderSidecarSchema>;

const judgeScore = z.number().int().min(0).max(5);

/** One order-swapped pairwise verdict, as written under `judge/`. */
export const JudgePairRecordSchema = z.strictObject({
  kind: z.literal("pair"),
  at: z.string().min(1),
  model: z.string().min(1),
  rubric: JudgeRubricSchema,
  /** `judgeFingerprint(rubric)` when written: the prompt and answer shape asked; a changed prompt is a new judge. */
  judge: z.string().min(1),
  a: z.string().min(1),
  b: z.string().min(1),
  winner: z.enum(["a", "b", "tie"]),
  confidence: z.number().min(0).max(1),
  agreed: z.boolean(),
  reasons: z.array(z.string()),
});

/** One absolute rubric score, as written under `judge/`. */
export const JudgeAbsoluteRecordSchema = z.strictObject({
  kind: z.literal("absolute"),
  at: z.string().min(1),
  model: z.string().min(1),
  rubric: JudgeRubricSchema,
  /** `scoreFingerprint(rubric)` when written; a changed prompt or axis set is a new scorer. */
  judge: z.string().min(1),
  render: z.string().min(1),
  axes: z.record(z.string(), judgeScore),
  overallAesthetic: judgeScore,
  total: z.number().int().min(0),
  max: z.number().int().min(0),
  notes: z.array(z.string()),
});

/** One ranked change proposed by `build critique --stage code`. */
export const CodeSuggestionSchema = z.strictObject({
  axis: z.string().min(1),
  change: z.string().min(1),
  where: z.string().min(1),
});
export type CodeSuggestion = z.infer<typeof CodeSuggestionSchema>;

/** One `build critique`: absolute scores on a render plus, with the program, ranked changes. */
export const JudgeCritiqueRecordSchema = z.strictObject({
  kind: z.literal("critique"),
  at: z.string().min(1),
  model: z.string().min(1),
  /** Visual scorer when the code-review model differs; absent in older records. */
  visualModel: z.string().min(1).optional(),
  rubric: JudgeRubricSchema,
  /** The render's name (`renders/<name>`), not a file. */
  render: z.string().min(1),
  /** The judge sheet the critic saw, relative to the build directory. */
  sheet: z.string().min(1),
  gridHash: z.string(),
  axes: z.record(z.string(), judgeScore),
  overallAesthetic: judgeScore,
  total: z.number().int().min(0),
  max: z.number().int().min(0),
  lowest: z.string().min(1),
  notes: z.array(z.string()),
  suggestions: z.array(CodeSuggestionSchema),
});

export const JudgeRecordSchema = z.discriminatedUnion("kind", [
  JudgePairRecordSchema,
  JudgeAbsoluteRecordSchema,
  JudgeCritiqueRecordSchema,
]);
export type JudgeRecord = z.infer<typeof JudgeRecordSchema>;

/** `candidates/<name>/candidate.json`: a saved version of the program and op log. */
export const CandidateSchema = z.strictObject({
  name: z.string().min(1),
  at: Iso,
  iteration: Iteration,
  gridHash: z.string(),
  /** Baseline contents and placement that the saved op log was judged against. */
  capture: z.strictObject({ siteHash: z.string(), box: BoxSchema }),
  size: BlockPosSchema,
  blocks: z.number().int(),
  /** Whether the candidate carries a build.ts. */
  program: z.boolean(),
  /** Checksum of the saved program copy, independent of later compile cleanup. */
  programHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .nullable(),
  ops: z.number().int(),
  /** The latest critique of this exact grid at save time, with its rubric, when one exists. */
  score: z
    .strictObject({ rubric: JudgeRubricSchema, total: z.number().int() })
    .nullable(),
});
export type Candidate = z.infer<typeof CandidateSchema>;
export const CANDIDATE_FILES = {
  info: "candidate.json",
  grid: "candidate.schem",
} as const;

export const WeOpLogSchema = z.strictObject({
  kind: z.literal("we"),
  world: z.string().min(1),
  command: z.string().regex(/^\/\//u),
  pos1: BlockPosSchema.optional(),
  pos2: BlockPosSchema.optional(),
  at: BlockPosSchema.optional(),
  /** Who produced the op: "manual" (recorded from the CLI) or "program:<sha>". */
  source: z.string(),
});
export const PasteOpLogSchema = z.strictObject({
  kind: z.literal("paste"),
  world: z.string().min(1),
  /** Path relative to the build directory, e.g. schematics/<sha>.schem. */
  schematic: z.string().min(1),
  at: BlockPosSchema,
  rotate: RotationSchema,
  ignoreAir: z.boolean(),
  source: z.string(),
});
export const CommandOpLogSchema = z.strictObject({
  kind: z.literal("command"),
  command: z.string().min(1),
  source: z.string(),
});
export const OpSchema = z.discriminatedUnion("kind", [
  WeOpLogSchema,
  PasteOpLogSchema,
  CommandOpLogSchema,
]);
export type Op = z.infer<typeof OpSchema>;

export const OpLogSchema = z.strictObject({
  version: z.literal(1),
  ops: z.array(OpSchema),
});
export type OpLog = z.infer<typeof OpLogSchema>;

export const BuildManifestSchema = z.strictObject({
  version: z.literal(1),
  name: SessionNameSchema,
  world: z.string().min(1),
  /** World position of build-local (0,0,0) for build.ts programs (front faces south). */
  anchor: BlockPosSchema,
  seed: z.number().int(),
  /** Captured site box; the canvas, replays and promotions all operate inside it. */
  site: z
    .strictObject({
      min: BlockPosSchema,
      max: BlockPosSchema,
      siteHash: z.string(),
    })
    .optional(),
  /** Sandbox id of the canvas seeded from the site. */
  canvas: z.string().optional(),
  /** Remaining bouts of an interrupted tournament, bound to its inputs and judge policy. */
  knockout: z
    .strictObject({
      fingerprint: z.string().min(1),
      /** Original pool plus its starting incumbent, retained across winner changes. */
      participants: z.array(z.string().min(1)),
      incumbent: z.string().min(1),
      pending: z.array(z.string().min(1)),
    })
    .optional(),
  /** The incumbent: the best candidate so far, kept by `build candidate knockout`. */
  best: z
    .strictObject({
      candidate: z.string().min(1),
      gridHash: z.string(),
      /** The rubric the knockout ran on; `score` is a total on it. */
      rubric: JudgeRubricSchema,
      score: z.number().nullable(),
    })
    .optional(),
});
export type BuildManifest = z.infer<typeof BuildManifestSchema>;

/** Reads a build directory's op log (an empty log when the file is absent). */
export async function readOpLog(dir: string): Promise<OpLog> {
  const file = Bun.file(path.join(dir, BUILD_FILES.oplog));
  return (await file.exists())
    ? OpLogSchema.parse(await file.json())
    : { version: 1, ops: [] };
}

export async function writeOpLog(dir: string, log: OpLog): Promise<void> {
  await Bun.write(
    path.join(dir, BUILD_FILES.oplog),
    `${JSON.stringify(OpLogSchema.parse(log), null, 2)}\n`,
  );
}

/** Appends one op that already succeeded against a target. */
export async function appendOp(dir: string, op: Op): Promise<number> {
  if (!(await Bun.file(path.join(dir, BUILD_FILES.manifest)).exists())) {
    throw new Error(
      `${dir} is not a build directory (no ${BUILD_FILES.manifest}); run toolkit mc build init first`,
    );
  }
  const log = await readOpLog(dir);
  log.ops.push(OpSchema.parse(op));
  await writeOpLog(dir, log);
  return log.ops.length;
}
