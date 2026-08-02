import { z } from "zod";
import {
  directionalMovementObservations,
  positionLoopOccurred,
  type MovementLoopState,
} from "./benchmark-movement-telemetry.ts";

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
  /** Number of `pokemonctl observe` invocations without `--full`. */
  compactObservations: number;
  /** Number of `pokemonctl observe --full` invocations. */
  fullObservations: number;
  /** Characters in completed command aggregated output, counted exactly once. */
  toolOutputCharacters: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  codexThreadId: string | null;
};

type TelemetryParseState = MovementLoopState & {
  countedTools: Set<string>;
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
    compactObservations: 0,
    fullObservations: 0,
    toolOutputCharacters: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    codexThreadId: null,
  };
  const state: TelemetryParseState = {
    countedTools: new Set<string>(),
    lastPosition: undefined,
    visitedPositions: new Set<string>(),
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
    classifyNonMovementCommand(result, command);
  }
  if (type !== "item.completed") return;
  if (item.data.exit_code !== undefined && item.data.exit_code !== 0) {
    result.toolErrors += 1;
    result.errors += 1;
  }
  const output = commandOutputText(item.data);
  result.toolOutputCharacters += output.length;
  for (const observation of directionalMovementObservations(command, output)) {
    result.movementActions += 1;
    if (observation.stopped) result.movementStops += 1;
    if (positionLoopOccurred(state, observation)) {
      result.repeatedPositionLoops += 1;
    }
  }
  result.ignoredInputs += [...output.matchAll(/ignored input/giu)].length;
}

function commandOutputText(item: z.infer<typeof ItemSchema>): string {
  if (item.aggregated_output !== undefined) return item.aggregated_output;
  return [item.stdout, item.stderr]
    .filter((value) => value !== undefined)
    .join("\n");
}

function commandText(command: string | unknown[] | undefined): string {
  if (typeof command === "string") return command;
  if (Array.isArray(command)) {
    const parts: string[] = [];
    for (const value of command) {
      if (typeof value === "string") parts.push(value);
    }
    return parts.join(" ");
  }
  return "";
}

function classifyNonMovementCommand(
  telemetry: CodexBenchmarkTelemetry,
  command: string,
): void {
  if (
    /\bpokemonctl\s+screenshot\b/.test(command) ||
    /\bpokemonctl\s+observe\b[^\n]*\s--screenshot(?:\s|$)/.test(command)
  ) {
    telemetry.screenshots += 1;
  }
  if (
    /\bpokemonctl\s+(?:grep|read|list)\b/.test(command) ||
    /(?:^|[\s/])(?:knowledge|\.agents\/skills)(?:[\s/]|$)/.test(command)
  ) {
    telemetry.knowledgeQueries += 1;
  }
  const observationInvocation =
    /(?:^|[\s"'`;|&])(?:[^\s"'`;|&]+\/)?pokemonctl["']?\s+observe\b([^;\n|&]*)/giu;
  for (const match of command.matchAll(observationInvocation)) {
    const argumentsText = match[1] ?? "";
    if (/(?:^|\s)--full(?=[\s"']|$)/u.test(argumentsText)) {
      telemetry.fullObservations += 1;
    } else {
      telemetry.compactObservations += 1;
    }
  }
}
