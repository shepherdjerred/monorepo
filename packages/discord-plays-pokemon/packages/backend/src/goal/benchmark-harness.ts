import path from "node:path";
import { z } from "zod";
import type { GameSnapshot } from "#src/game/events/types.ts";
import type { BenchmarkProviderFailure } from "./benchmark-provider-failure.ts";

export const DEFAULT_BENCHMARK_GOAL = "get me a pokeman";

const ReasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh"]);

const BenchmarkArgsSchema = z.strictObject({
  save: z.string().min(1),
  wasm: z.string().min(1),
  output: z.string().min(1),
  runs: z.coerce.number().int().positive().max(100).default(1),
  goal: z.string().min(1).default(DEFAULT_BENCHMARK_GOAL),
  model: z.string().min(1).default("gpt-5.6-luna"),
  reasoning: ReasoningEffortSchema.default("medium"),
  runtimeMinutes: z.coerce.number().int().positive().max(30).default(30),
  controlHost: z.string().min(1).default("127.0.0.1"),
  controlPort: z.coerce.number().int().min(1024).max(49_151).default(18_082),
  portStride: z.coerce.number().int().positive().default(1),
  codexBinary: z.string().min(1).default("codex"),
  implementationRoot: z.string().min(1),
  bootTimeoutSeconds: z.coerce.number().int().positive().max(300).default(60),
});

export type BenchmarkArgs = z.infer<typeof BenchmarkArgsSchema>;

function resolvePathLikeCommand(command: string, cwd: string): string {
  return path.isAbsolute(command) || command.includes(path.sep)
    ? path.resolve(cwd, command)
    : command;
}

const FLAG_TO_FIELD = new Map<string, keyof BenchmarkArgs>([
  ["--save", "save"],
  ["--wasm", "wasm"],
  ["--output", "output"],
  ["--runs", "runs"],
  ["--goal", "goal"],
  ["--model", "model"],
  ["--reasoning", "reasoning"],
  ["--runtime", "runtimeMinutes"],
  ["--runtime-minutes", "runtimeMinutes"],
  ["--control-host", "controlHost"],
  ["--control-port", "controlPort"],
  ["--port-stride", "portStride"],
  ["--codex-binary", "codexBinary"],
  ["--implementation-root", "implementationRoot"],
  ["--boot-timeout-seconds", "bootTimeoutSeconds"],
]);

export function parseBenchmarkArgs(
  argv: readonly string[],
  defaultImplementationRoot: string,
  cwd: string,
): BenchmarkArgs {
  const raw: Record<string, string> = {
    implementationRoot: defaultImplementationRoot,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) {
      throw new Error("argument parser reached an invalid index");
    }
    const equalsIndex = argument.indexOf("=");
    const flag = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const field = FLAG_TO_FIELD.get(flag);
    if (field === undefined) {
      throw new Error(`unknown argument: ${argument}`);
    }
    if (field !== "implementationRoot" && raw[field] !== undefined) {
      throw new Error(`duplicate argument: ${flag}`);
    }
    if (
      field === "implementationRoot" &&
      raw[field] !== defaultImplementationRoot
    ) {
      throw new Error(`duplicate argument: ${flag}`);
    }
    const inlineValue =
      equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);
    const nextValue = argv[index + 1];
    const value = inlineValue ?? nextValue;
    if (value === undefined || value.length === 0) {
      throw new Error(`${flag} requires a value`);
    }
    raw[field] = value;
    if (inlineValue === undefined) {
      index += 1;
    }
  }

  const parsed = BenchmarkArgsSchema.parse(raw);
  const highestPort =
    parsed.controlPort + (parsed.runs - 1) * parsed.portStride;
  if (highestPort > 49_151) {
    throw new Error(
      `highest per-run control port ${String(highestPort)} exceeds 49151`,
    );
  }
  return {
    ...parsed,
    save: path.resolve(cwd, parsed.save),
    wasm: path.resolve(cwd, parsed.wasm),
    output: path.resolve(cwd, parsed.output),
    codexBinary: resolvePathLikeCommand(parsed.codexBinary, cwd),
    implementationRoot: path.resolve(cwd, parsed.implementationRoot),
  };
}

const PartyMonSchema = z.strictObject({
  personality: z.number().int().nonnegative(),
  otId: z.number().int().nonnegative(),
  species: z.number().int().nonnegative(),
  level: z.number().int().nonnegative(),
  hp: z.number().int().nonnegative(),
  maxHp: z.number().int().nonnegative(),
  isEgg: z.boolean(),
  nickname: z.string(),
});

export const SerializedSnapshotSchema = z.strictObject({
  party: z.array(PartyMonSchema),
  badges: z.array(z.boolean()).length(8),
  dexOwned: z.array(z.number().int().min(0).max(255)).length(52),
  caughtMonSpecies: z.number().int().nonnegative(),
  caughtMonShiny: z.boolean(),
});

export type SerializedSnapshot = z.infer<typeof SerializedSnapshotSchema>;

const CatchEventSchema = z.strictObject({
  occurredAt: z.string(),
  frame: z.number().int().nonnegative(),
  species: z.number().int().nonnegative(),
  nationalDexNumber: z.number().int().positive(),
  postEventParty: z.array(
    z.strictObject({
      personality: z.number().int().nonnegative(),
      otId: z.number().int().nonnegative(),
      species: z.number().int().nonnegative(),
    }),
  ),
  postEventNationalDexOwned: z.boolean(),
});

const GoalStateSchema = z.strictObject({
  id: z.string(),
  goal: z.string(),
  requestedBy: z.string(),
  startedAt: z.string(),
  status: z.enum([
    "running",
    "completed",
    "failed",
    "timeout",
    "replaced",
    "shutdown",
  ]),
  finishedAt: z.string(),
  finalReport: z.string().optional(),
  exitCode: z.number().int().optional(),
});

export const BenchmarkWorkerResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  goalState: GoalStateSchema,
  initialSnapshot: SerializedSnapshotSchema,
  finalSnapshot: SerializedSnapshotSchema,
  evidenceCapturedFrame: z.number().int().nonnegative(),
  catchEvents: z.array(CatchEventSchema),
  persistedSave: z.strictObject({
    persistedAt: z.string(),
    byteLength: z.number().int().nonnegative(),
    snapshot: SerializedSnapshotSchema,
  }),
});

export type BenchmarkWorkerResult = z.infer<typeof BenchmarkWorkerResultSchema>;

export function deserializeSnapshot(
  snapshot: SerializedSnapshot,
): GameSnapshot {
  return {
    party: snapshot.party,
    badges: snapshot.badges,
    dexOwned: new Uint8Array(snapshot.dexOwned),
    caughtMonSpecies: snapshot.caughtMonSpecies,
    caughtMonShiny: snapshot.caughtMonShiny,
  };
}

export type BenchmarkRunOutcome =
  | "success"
  | "game-failure"
  | "invalid-provider"
  | "harness-error";

export type BenchmarkRunSummaryEntry = {
  run: number;
  success: boolean;
  outcome: BenchmarkRunOutcome;
  providerFailure: BenchmarkProviderFailure | null;
  durationMs: number;
  telemetry: {
    turns: number;
    toolCalls: number;
    errors: number;
    compactObservations: number;
    fullObservations: number;
    toolOutputCharacters: number;
    inputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    estimatedCostUsd: number | null;
  };
};

export function buildBenchmarkSummary(
  requestedRuns: number,
  entries: readonly BenchmarkRunSummaryEntry[],
): {
  schemaVersion: 1;
  requestedRuns: number;
  completedRuns: number;
  validRuns: number;
  successfulRuns: number;
  failedRuns: number;
  invalidRuns: number;
  providerFailureRuns: number;
  harnessErrorRuns: number;
  stoppedEarly: boolean;
  stopReason: "external-provider-failure" | null;
  successRate: number | null;
  allSucceeded: boolean;
  totals: {
    durationMs: number;
    turns: number;
    toolCalls: number;
    errors: number;
    compactObservations: number;
    fullObservations: number;
    toolOutputCharacters: number;
    inputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    knownCostUsd: number;
    runsWithUnknownCost: number;
  };
  runs: readonly BenchmarkRunSummaryEntry[];
} {
  const successfulRuns = entries.filter(
    (entry) => entry.outcome === "success",
  ).length;
  const failedRuns = entries.filter(
    (entry) => entry.outcome === "game-failure",
  ).length;
  const providerFailureRuns = entries.filter(
    (entry) => entry.outcome === "invalid-provider",
  ).length;
  const harnessErrorRuns = entries.filter(
    (entry) => entry.outcome === "harness-error",
  ).length;
  const invalidRuns = providerFailureRuns + harnessErrorRuns;
  const validRuns = successfulRuns + failedRuns;
  const stoppedEarly = entries.length < requestedRuns;
  const totals = {
    durationMs: 0,
    turns: 0,
    toolCalls: 0,
    errors: 0,
    compactObservations: 0,
    fullObservations: 0,
    toolOutputCharacters: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    knownCostUsd: 0,
    runsWithUnknownCost: 0,
  };
  for (const entry of entries) {
    totals.durationMs += entry.durationMs;
    totals.turns += entry.telemetry.turns;
    totals.toolCalls += entry.telemetry.toolCalls;
    totals.errors += entry.telemetry.errors;
    totals.compactObservations += entry.telemetry.compactObservations;
    totals.fullObservations += entry.telemetry.fullObservations;
    totals.toolOutputCharacters += entry.telemetry.toolOutputCharacters;
    totals.inputTokens += entry.telemetry.inputTokens;
    totals.outputTokens += entry.telemetry.outputTokens;
    totals.reasoningOutputTokens += entry.telemetry.reasoningOutputTokens;
    if (entry.telemetry.estimatedCostUsd === null) {
      totals.runsWithUnknownCost += 1;
    } else {
      totals.knownCostUsd += entry.telemetry.estimatedCostUsd;
    }
  }
  return {
    schemaVersion: 1,
    requestedRuns,
    completedRuns: entries.length,
    validRuns,
    successfulRuns,
    failedRuns,
    invalidRuns,
    providerFailureRuns,
    harnessErrorRuns,
    stoppedEarly,
    stopReason:
      stoppedEarly && providerFailureRuns > 0
        ? "external-provider-failure"
        : null,
    successRate: validRuns === 0 ? null : successfulRuns / validRuns,
    allSucceeded:
      entries.length === requestedRuns && successfulRuns === requestedRuns,
    totals,
    runs: entries,
  };
}
