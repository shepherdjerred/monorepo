import { z } from "zod";
import type {
  CodexCommandCall,
  CodexTurnItem,
  TrajectoryItem,
} from "@shepherdjerred/ops-model/llm-traces.ts";
import {
  parseTrajectoryMessages,
  safeJsonParse,
} from "./trajectory-messages.ts";

export type CodexCandidateSpan = {
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly service: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly durationMs: number | null;
  readonly status: "ok" | "error" | "unset";
  readonly statusMessage: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly envelope: Readonly<Record<string, unknown>> | undefined;
  readonly archiveKey: string | null;
};

const StringArraySchema = z.array(z.string());

function readString(
  attrs: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = attrs[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function readNumber(
  attrs: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = attrs[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readSuffixString(
  attrs: Readonly<Record<string, unknown>>,
  suffix: string,
): string | undefined {
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "string" && key.endsWith(suffix)) {
      return value;
    }
  }
  return undefined;
}

function readSuffixNumber(
  attrs: Readonly<Record<string, unknown>>,
  suffix: string,
): number | undefined {
  for (const [key, value] of Object.entries(attrs)) {
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      key.endsWith(suffix)
    ) {
      return value;
    }
  }
  return undefined;
}

function readBodyField(span: CodexCandidateSpan, key: string): unknown {
  const fromEnvelope = span.envelope?.[key];
  return fromEnvelope === undefined ? span.attributes[key] : fromEnvelope;
}

export function isCodexSystem(
  attrs: Readonly<Record<string, unknown>>,
): boolean {
  const system = attrs["gen_ai.system"] ?? attrs["gen_ai.provider.name"];
  return system === "codex_sdk" || system === "codex_cli";
}

function isCodexToolSpan(span: CodexCandidateSpan): boolean {
  return (
    span.name.endsWith(".tool") ||
    readBodyField(span, "gen_ai.tool.stdout") !== undefined ||
    readBodyField(span, "gen_ai.tool.stderr") !== undefined ||
    readSuffixString(span.attributes, ".command") !== undefined
  );
}

function isCodexTurnSpan(span: CodexCandidateSpan): boolean {
  return (
    span.name.endsWith(".turn") ||
    readSuffixNumber(span.attributes, ".turn_index") !== undefined ||
    (!span.name.endsWith(".run") && !isCodexToolSpan(span))
  );
}

function extractTurnPrompt(rawInput: unknown): string | null {
  if (rawInput === undefined || rawInput === null) {
    return null;
  }
  if (typeof rawInput === "string") {
    const parsed = safeJsonParse(rawInput);
    if (typeof parsed === "string") {
      return parsed === "" ? null : parsed;
    }
  }
  const messages = parseTrajectoryMessages(rawInput, "user");
  const texts: string[] = [];
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.kind === "text" && part.text !== "") {
        texts.push(part.text);
      }
    }
  }
  return texts.length === 0 ? null : texts.join("\n\n");
}

function extractTurnAssistantMessages(rawOutput: unknown): string[] {
  if (rawOutput === undefined || rawOutput === null) {
    return [];
  }
  const parsed = safeJsonParse(rawOutput);
  const strArr = StringArraySchema.safeParse(parsed);
  if (strArr.success) {
    return strArr.data;
  }
  const messages = parseTrajectoryMessages(parsed, "assistant");
  const texts: string[] = [];
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.kind === "text" && part.text !== "") {
        texts.push(part.text);
      }
    }
  }
  return texts;
}

function buildCodexTurnItem(
  span: CodexCandidateSpan,
  fallbackIndex: number,
): CodexTurnItem {
  const rawTurnIdx = readSuffixNumber(span.attributes, ".turn_index");
  const turnIndex =
    rawTurnIdx !== undefined && rawTurnIdx >= 1
      ? Math.trunc(rawTurnIdx)
      : fallbackIndex;

  return {
    spanId: span.spanId,
    turnIndex,
    prompt: extractTurnPrompt(readBodyField(span, "gen_ai.input.messages")),
    assistantMessages: extractTurnAssistantMessages(
      readBodyField(span, "gen_ai.output.messages"),
    ),
    inputTokens: Math.max(
      0,
      Math.trunc(readNumber(span.attributes, "gen_ai.usage.input_tokens") ?? 0),
    ),
    cachedInputTokens: Math.max(
      0,
      Math.trunc(
        readNumber(span.attributes, "gen_ai.usage.cache_read_input_tokens") ??
          readNumber(span.attributes, "gen_ai.usage.cache_read.input_tokens") ??
          0,
      ),
    ),
    outputTokens: Math.max(
      0,
      Math.trunc(
        readNumber(span.attributes, "gen_ai.usage.output_tokens") ?? 0,
      ),
    ),
    reasoningTokens: Math.max(
      0,
      Math.trunc(
        readNumber(span.attributes, "gen_ai.usage.reasoning_tokens") ?? 0,
      ),
    ),
  };
}

function buildCodexCommandCall(span: CodexCandidateSpan): CodexCommandCall {
  const rawStdout = readBodyField(span, "gen_ai.tool.stdout");
  const rawStderr = readBodyField(span, "gen_ai.tool.stderr");
  const exitCode = readSuffixNumber(span.attributes, ".exit_code");
  const attrDuration = readSuffixNumber(span.attributes, ".duration_ms");

  return {
    spanId: span.spanId,
    callId: readSuffixString(span.attributes, ".call_id") ?? null,
    command: readSuffixString(span.attributes, ".command") ?? "",
    exitCode: exitCode === undefined ? null : Math.trunc(exitCode),
    durationMs:
      attrDuration !== undefined && attrDuration >= 0
        ? attrDuration
        : span.durationMs,
    stdout:
      typeof rawStdout === "string"
        ? rawStdout
        : (readSuffixString(span.attributes, ".stdout_snippet") ?? ""),
    stderr:
      typeof rawStderr === "string"
        ? rawStderr
        : (readSuffixString(span.attributes, ".stderr_snippet") ?? ""),
  };
}

function sumCodexTurnTokens(
  anchor: CodexCandidateSpan,
  turns: readonly CodexTurnItem[],
): {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
} {
  if (turns.length === 0) {
    return {
      inputTokens: Math.trunc(
        readNumber(anchor.attributes, "gen_ai.usage.input_tokens") ?? 0,
      ),
      outputTokens: Math.trunc(
        readNumber(anchor.attributes, "gen_ai.usage.output_tokens") ?? 0,
      ),
      cachedInputTokens: Math.trunc(
        readNumber(anchor.attributes, "gen_ai.usage.cache_read_input_tokens") ??
          0,
      ),
      reasoningTokens: Math.trunc(
        readNumber(anchor.attributes, "gen_ai.usage.reasoning_tokens") ?? 0,
      ),
    };
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let reasoningTokens = 0;
  for (const turn of turns) {
    inputTokens += turn.inputTokens;
    outputTokens += turn.outputTokens;
    cachedInputTokens += turn.cachedInputTokens;
    reasoningTokens += turn.reasoningTokens;
  }
  return { inputTokens, outputTokens, cachedInputTokens, reasoningTokens };
}

function partitionCodexChildren(
  anchor: CodexCandidateSpan,
  sorted: readonly CodexCandidateSpan[],
): { turns: CodexTurnItem[]; commands: CodexCommandCall[] } {
  const turns: CodexTurnItem[] = [];
  const commands: CodexCommandCall[] = [];
  for (const span of sorted) {
    if (span.spanId === anchor.spanId && anchor.name.endsWith(".run")) {
      continue;
    }
    if (isCodexToolSpan(span)) {
      commands.push(buildCodexCommandCall(span));
    } else if (isCodexTurnSpan(span)) {
      turns.push(buildCodexTurnItem(span, turns.length + 1));
    }
  }
  turns.sort((a, b) => a.turnIndex - b.turnIndex);
  return { turns, commands };
}

function assembleCodexTrajectoryItem(
  anchor: CodexCandidateSpan,
  memberSpans: readonly CodexCandidateSpan[],
): TrajectoryItem {
  const sorted = [...memberSpans].sort(
    (a, b) => a.startedAtMs - b.startedAtMs || a.spanId.localeCompare(b.spanId),
  );
  const { turns, commands } = partitionCodexChildren(anchor, sorted);
  const usage = sumCodexTurnTokens(anchor, turns);
  const hasError =
    anchor.status === "error" || sorted.some((s) => s.status === "error");
  const errorSpan = sorted.find((s) => s.status === "error");
  const provider =
    readString(anchor.attributes, "gen_ai.system") ??
    readString(anchor.attributes, "gen_ai.provider.name") ??
    "codex_sdk";
  const model =
    readString(anchor.attributes, "gen_ai.request.model") ??
    readString(anchor.attributes, "gen_ai.response.model") ??
    null;

  return {
    shape: "codex-agent",
    spanId: anchor.spanId,
    parentSpanId: anchor.parentSpanId,
    spanName: anchor.name,
    service: readString(anchor.attributes, "llm.service") ?? anchor.service,
    workload: readString(anchor.attributes, "llm.call_site") ?? null,
    provider,
    requestedModel: model,
    responseModel:
      readString(anchor.attributes, "gen_ai.response.model") ?? model,
    responseId: readString(anchor.attributes, "gen_ai.response.id") ?? null,
    finishReasons: [],
    startedAtMs: anchor.startedAtMs,
    durationMs: anchor.durationMs,
    status: hasError ? "error" : anchor.status,
    errorMessage: anchor.statusMessage ?? errorSpan?.statusMessage ?? null,
    ...usage,
    cacheCreationTokens: 0,
    catalogCostUsd: null,
    costKind: "subscription",
    archiveKey:
      anchor.archiveKey ??
      sorted.find((s) => s.archiveKey !== null)?.archiveKey ??
      null,
    turns,
    commands,
  };
}

function isCodexMemberSpan(span: CodexCandidateSpan): boolean {
  return (
    isCodexSystem(span.attributes) ||
    span.name.endsWith(".turn") ||
    span.name.endsWith(".tool")
  );
}

export function extractCodexGroups(
  allSpans: readonly CodexCandidateSpan[],
  childrenByParent: ReadonlyMap<string, CodexCandidateSpan[]>,
): {
  items: TrajectoryItem[];
  consumedSpanIds: Set<string>;
} {
  const consumedSpanIds = new Set<string>();
  const items: TrajectoryItem[] = [];

  const collectDescendants = (rootId: string): CodexCandidateSpan[] => {
    const descendants: CodexCandidateSpan[] = [];
    const stack = [...(childrenByParent.get(rootId) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || consumedSpanIds.has(current.spanId)) {
        continue;
      }
      descendants.push(current);
      stack.push(...(childrenByParent.get(current.spanId) ?? []));
    }
    return descendants;
  };

  for (const span of allSpans) {
    if (!span.name.endsWith(".run")) {
      continue;
    }
    const descendants = collectDescendants(span.spanId);
    const codexMembers = descendants.filter((d) => isCodexMemberSpan(d));
    if (!isCodexSystem(span.attributes) && codexMembers.length === 0) {
      continue;
    }
    consumedSpanIds.add(span.spanId);
    for (const member of codexMembers) {
      consumedSpanIds.add(member.spanId);
    }
    items.push(assembleCodexTrajectoryItem(span, codexMembers));
  }

  const orphanCodexSpans = allSpans.filter(
    (s) => !consumedSpanIds.has(s.spanId) && isCodexSystem(s.attributes),
  );
  const firstOrphan = [...orphanCodexSpans].sort(
    (a, b) => a.startedAtMs - b.startedAtMs || a.spanId.localeCompare(b.spanId),
  )[0];
  if (firstOrphan !== undefined) {
    for (const orphan of orphanCodexSpans) {
      consumedSpanIds.add(orphan.spanId);
    }
    items.push(assembleCodexTrajectoryItem(firstOrphan, orphanCodexSpans));
  }

  return { items, consumedSpanIds };
}
