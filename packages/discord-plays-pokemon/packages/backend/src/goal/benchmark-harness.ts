import path from "node:path";
import { z } from "zod";
import type { GameSnapshot } from "#src/game/events/types.ts";

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
    if (raw[field] !== undefined && field !== "implementationRoot") {
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
  species: z.number().int().nonnegative(),
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
  catchEvents: z.array(CatchEventSchema),
  persistedSave: z.strictObject({
    persistedAt: z.string(),
    byteLength: z.number().int().nonnegative(),
    snapshot: SerializedSnapshotSchema,
  }),
});

export type BenchmarkWorkerResult = z.infer<typeof BenchmarkWorkerResultSchema>;

export function serializeSnapshot(snapshot: GameSnapshot): SerializedSnapshot {
  return {
    party: [...snapshot.party],
    badges: [...snapshot.badges],
    dexOwned: [...snapshot.dexOwned],
    caughtMonSpecies: snapshot.caughtMonSpecies,
    caughtMonShiny: snapshot.caughtMonShiny,
  };
}

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

export type CodexBenchmarkTelemetry = {
  turns: number;
  toolCalls: number;
  toolErrors: number;
  errors: number;
  movementActions: number;
  movementStops: number;
  repeatedPositionLoops: number;
  ignoredInputs: number;
  screenshots: number;
  knowledgeQueries: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  codexThreadId: string | null;
};

type TelemetryParseState = {
  countedTools: Set<string>;
  lastMovementCommand: string | undefined;
  repeatedMovementCount: number;
};

const RecordSchema = z.record(z.string(), z.unknown());
const ItemSchema = z.looseObject({
  id: z.string().optional(),
  type: z.string().optional(),
  command: z.union([z.string(), z.array(z.unknown())]).optional(),
  aggregated_output: z.string().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exit_code: z.number().optional(),
});
const UsageSchema = z.looseObject({
  input_tokens: z.number().int().nonnegative().optional(),
  cached_input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  reasoning_output_tokens: z.number().int().nonnegative().optional(),
});

export function summarizeCodexJsonl(jsonl: string): CodexBenchmarkTelemetry {
  const result: CodexBenchmarkTelemetry = {
    turns: 0,
    toolCalls: 0,
    toolErrors: 0,
    errors: 0,
    movementActions: 0,
    movementStops: 0,
    repeatedPositionLoops: 0,
    ignoredInputs: 0,
    screenshots: 0,
    knowledgeQueries: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    codexThreadId: null,
  };
  const state: TelemetryParseState = {
    countedTools: new Set<string>(),
    lastMovementCommand: undefined,
    repeatedMovementCount: 0,
  };

  for (const line of jsonl.split("\n")) {
    consumeCodexLine(line, result, state);
  }
  return result;
}

function consumeCodexLine(
  line: string,
  result: CodexBenchmarkTelemetry,
  state: TelemetryParseState,
): void {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    result.errors += 1;
    return;
  }
  const record = RecordSchema.safeParse(raw);
  if (!record.success) {
    result.errors += 1;
    return;
  }
  const type =
    typeof record.data["type"] === "string" ? record.data["type"] : "";
  countLifecycleEvent(result, type, record.data);
  if (type !== "item.started" && type !== "item.completed") return;
  countCommandEvent(result, state, type, record.data["item"]);
}

function countLifecycleEvent(
  result: CodexBenchmarkTelemetry,
  type: string,
  record: Record<string, unknown>,
): void {
  if (type === "thread.started") {
    const threadId = record["thread_id"];
    if (typeof threadId === "string") result.codexThreadId = threadId;
  }
  if (type === "turn.started") result.turns += 1;
  if (type === "turn.completed") {
    const usage = UsageSchema.safeParse(record["usage"]);
    if (usage.success) {
      result.inputTokens += usage.data.input_tokens ?? 0;
      result.cachedInputTokens += usage.data.cached_input_tokens ?? 0;
      result.outputTokens += usage.data.output_tokens ?? 0;
      result.reasoningOutputTokens += usage.data.reasoning_output_tokens ?? 0;
    }
  }
  if (type.includes("error") || type.endsWith(".failed")) {
    result.errors += 1;
  }
}

function countCommandEvent(
  result: CodexBenchmarkTelemetry,
  state: TelemetryParseState,
  type: string,
  rawItem: unknown,
): void {
  const item = ItemSchema.safeParse(rawItem);
  if (!item.success || item.data.type !== "command_execution") return;
  const id = item.data.id ?? `${type}:${String(result.toolCalls)}`;
  const command = commandText(item.data.command);
  if (!state.countedTools.has(id)) {
    state.countedTools.add(id);
    result.toolCalls += 1;
    classifyCommand(result, command);
    countRepeatedMovement(result, state, command);
  }
  if (type !== "item.completed") return;
  if (item.data.exit_code !== undefined && item.data.exit_code !== 0) {
    result.toolErrors += 1;
    result.errors += 1;
  }
  const output = [
    item.data.aggregated_output,
    item.data.stdout,
    item.data.stderr,
  ]
    .filter((value) => value !== undefined)
    .join("\n");
  if (isMovementCommand(command) && /"blocked"\s*:\s*true/.test(output)) {
    result.movementStops += 1;
  }
  if (/ignored input/i.test(output)) result.ignoredInputs += 1;
}

function countRepeatedMovement(
  result: CodexBenchmarkTelemetry,
  state: TelemetryParseState,
  command: string,
): void {
  if (!isMovementCommand(command)) return;
  if (command !== state.lastMovementCommand) {
    state.lastMovementCommand = command;
    state.repeatedMovementCount = 0;
    return;
  }
  state.repeatedMovementCount += 1;
  if (state.repeatedMovementCount >= 2) {
    result.repeatedPositionLoops += 1;
  }
}

function commandText(command: string | unknown[] | undefined): string {
  if (typeof command === "string") return command;
  if (Array.isArray(command)) return command.map(String).join(" ");
  return "";
}

function classifyCommand(
  telemetry: CodexBenchmarkTelemetry,
  command: string,
): void {
  if (isMovementCommand(command)) telemetry.movementActions += 1;
  if (/\bpokemonctl\s+screenshot\b/.test(command)) telemetry.screenshots += 1;
  if (
    /\bpokemonctl\s+(?:grep|read|list)\b/.test(command) ||
    /(?:^|[\s/])(?:knowledge|\.agents\/skills)(?:[\s/]|$)/.test(command)
  ) {
    telemetry.knowledgeQueries += 1;
  }
}

function isMovementCommand(command: string): boolean {
  return /\bpokemonctl\s+(?:press|chord|move|tap|navigate|interact)\b/.test(
    command,
  );
}

export type BenchmarkRunSummaryEntry = {
  run: number;
  success: boolean;
  durationMs: number;
  telemetry: {
    turns: number;
    toolCalls: number;
    errors: number;
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
  successfulRuns: number;
  failedRuns: number;
  allSucceeded: boolean;
  totals: {
    durationMs: number;
    turns: number;
    toolCalls: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    knownCostUsd: number;
    runsWithUnknownCost: number;
  };
  runs: readonly BenchmarkRunSummaryEntry[];
} {
  const successfulRuns = entries.filter((entry) => entry.success).length;
  const totals = {
    durationMs: 0,
    turns: 0,
    toolCalls: 0,
    errors: 0,
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
    successfulRuns,
    failedRuns: entries.length - successfulRuns,
    allSucceeded:
      entries.length === requestedRuns && successfulRuns === requestedRuns,
    totals,
    runs: entries,
  };
}
