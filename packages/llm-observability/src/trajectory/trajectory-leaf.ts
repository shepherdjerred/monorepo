import {
  costForDecisionUsage,
  costForTextUsage,
  modelIdForNativeRoute,
  ProviderSchema,
} from "@shepherdjerred/llm-models";
import type {
  TrajectoryItem,
  TrajectoryMessage,
} from "@shepherdjerred/ops-model/llm-traces.ts";
import { z } from "zod";
import type { CodexCandidateSpan } from "./trajectory-codex.ts";
import {
  buildClaudeAgentTrajectoryItem,
  buildOpenAiDecisionTrajectoryItem,
  tryParseDecisionInputPayload,
} from "./trajectory-decisions.ts";
import {
  buildLegacyAiSdkOutputMessages,
  extractEmbeddingSummary,
  normalizeSystemInstructions,
  parseTrajectoryMessages,
  safeJsonParse,
  stringifyJson,
} from "./trajectory-messages.ts";

const StringArraySchema = z.array(z.string());
const LooseRecordSchema = z.record(z.string(), z.unknown());

export function readSpanString(
  attrs: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const val = attrs[key];
  return typeof val === "string" && val.trim() !== "" ? val : undefined;
}

export function readSpanNumber(
  attrs: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const val = attrs[key];
  return typeof val === "number" && Number.isFinite(val) ? val : undefined;
}

function readSpanStringArray(
  attrs: Readonly<Record<string, unknown>>,
  key: string,
): string[] {
  const parsed = StringArraySchema.safeParse(attrs[key]);
  return parsed.success ? parsed.data : [];
}

export function readSpanBodyValue(
  span: CodexCandidateSpan,
  key: string,
): unknown {
  const fromEnv = span.envelope?.[key];
  return fromEnv === undefined ? span.attributes[key] : fromEnv;
}

export function isEmbedSpan(span: CodexCandidateSpan): boolean {
  return (
    span.attributes["gen_ai.operation.name"] === "embeddings" ||
    span.name === "gen_ai.embeddings" ||
    span.name.startsWith("embeddings ") ||
    span.name.startsWith("ai.embed") ||
    readSpanBodyValue(span, "ai.value") !== undefined ||
    readSpanBodyValue(span, "ai.values") !== undefined ||
    readSpanBodyValue(span, "ai.embedding") !== undefined ||
    readSpanBodyValue(span, "ai.embeddings") !== undefined
  );
}

function normalizeProviderPrefix(provider: string): string {
  if (provider.startsWith("openai")) {
    return "openai";
  }
  if (provider.startsWith("anthropic")) {
    return "anthropic";
  }
  return provider.startsWith("google") || provider.startsWith("gcp.")
    ? "google"
    : provider;
}

function tryCatalogLookup(
  provParsed: ReturnType<typeof ProviderSchema.safeParse>,
  modelCandidate: string,
): string | undefined {
  if (
    costForTextUsage(modelCandidate, { inputTokens: 0, outputTokens: 0 }) !==
      undefined ||
    costForDecisionUsage(modelCandidate, { inputTokens: 0 }) !== undefined
  ) {
    return modelCandidate;
  }
  return provParsed.success
    ? modelIdForNativeRoute(provParsed.data, modelCandidate)
    : undefined;
}

function resolveCatalogModelId(
  provider: string,
  candidates: readonly (string | null | undefined)[],
): string | undefined {
  const provParsed = ProviderSchema.safeParse(
    normalizeProviderPrefix(provider),
  );
  let fallbackNonEmpty: string | undefined;

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") {
      continue;
    }
    fallbackNonEmpty ??= candidate;
    const direct = tryCatalogLookup(provParsed, candidate);
    if (direct !== undefined) {
      return direct;
    }
    const slashIdx = candidate.indexOf("/");
    if (slashIdx > 0 && slashIdx < candidate.length - 1) {
      const stripped = tryCatalogLookup(
        provParsed,
        candidate.slice(slashIdx + 1),
      );
      if (stripped !== undefined) {
        return stripped;
      }
    }
  }
  return fallbackNonEmpty;
}

function pickAncestorAttr(
  ancestors: readonly CodexCandidateSpan[],
  keys: readonly string[],
): string | undefined {
  for (const anc of ancestors) {
    for (const key of keys) {
      const val = readSpanString(anc.attributes, key);
      if (val !== undefined) {
        return val;
      }
    }
  }
  return undefined;
}

function pickInheritedAttr(
  span: CodexCandidateSpan,
  ancestors: readonly CodexCandidateSpan[],
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const own = readSpanString(span.attributes, key);
    if (own !== undefined) {
      return own;
    }
  }
  return pickAncestorAttr(ancestors, keys);
}

function pickInheritedBody(
  span: CodexCandidateSpan,
  ancestors: readonly CodexCandidateSpan[],
  key: string,
): unknown {
  const own = readSpanBodyValue(span, key);
  if (own !== undefined) return own;
  for (const anc of ancestors) {
    const val = readSpanBodyValue(anc, key);
    if (val !== undefined) return val;
  }
  return undefined;
}

function readFirstTokenInt(
  attrs: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): number {
  for (const key of keys) {
    const val = readSpanNumber(attrs, key);
    if (val !== undefined) return Math.max(0, Math.trunc(val));
  }
  return 0;
}

function extractUsageTokens(span: CodexCandidateSpan) {
  const attrs = span.attributes;
  return {
    inputTokens: readFirstTokenInt(attrs, [
      "gen_ai.usage.input_tokens",
      "ai.usage.inputTokens",
      "ai.usage.promptTokens",
      "ai.usage.tokens",
    ]),
    outputTokens: readFirstTokenInt(attrs, [
      "gen_ai.usage.output_tokens",
      "ai.usage.outputTokens",
      "ai.usage.completionTokens",
    ]),
    cachedInputTokens: readFirstTokenInt(attrs, [
      "gen_ai.usage.cache_read_input_tokens",
      "gen_ai.usage.cache_read.input_tokens",
    ]),
    cacheCreationTokens: readFirstTokenInt(attrs, [
      "gen_ai.usage.cache_creation_input_tokens",
      "gen_ai.usage.cache_creation.input_tokens",
    ]),
    reasoningTokens: readFirstTokenInt(attrs, [
      "gen_ai.usage.reasoning_tokens",
      "ai.usage.outputTokenDetails.reasoningTokens",
    ]),
  };
}

function isRetryAttrKey(lowerKey: string): boolean {
  return lowerKey.endsWith(".retry") || lowerKey.endsWith(".attempt");
}

function hasExplicitRepairSignal(span: CodexCandidateSpan): boolean {
  if (span.name.toLowerCase().includes("repair")) {
    return true;
  }
  for (const [key, value] of Object.entries(span.attributes)) {
    const lower = key.toLowerCase();
    if (
      value !== false &&
      value !== 0 &&
      value !== "" &&
      lower.includes("repair")
    ) {
      return true;
    }
    if (typeof value === "number" && value > 1 && isRetryAttrKey(lower)) {
      return true;
    }
  }
  return false;
}

export function messagesContainToolCall(
  messages: readonly TrajectoryMessage[],
  finishReasons: readonly string[],
): boolean {
  return (
    finishReasons.some(
      (r) => r === "tool-calls" || r === "tool_call" || r === "tool_use",
    ) || messages.some((m) => m.parts.some((p) => p.kind === "tool-call"))
  );
}

type LeafBaseFields = Omit<
  Extract<TrajectoryItem, { shape: "ai-sdk-embed" }>,
  | "shape"
  | "catalogCostUsd"
  | "costKind"
  | "inputCount"
  | "inputPreviews"
  | "dimensions"
> & { readonly ownReqModel: string | undefined };

function buildBaseLeafFields(
  span: CodexCandidateSpan,
  ancestors: readonly CodexCandidateSpan[],
): LeafBaseFields {
  const provider =
    pickInheritedAttr(span, ancestors, [
      "gen_ai.system",
      "gen_ai.provider.name",
      "ai.model.provider",
    ]) ?? "unknown";
  const service =
    pickInheritedAttr(span, ancestors, ["llm.service"]) ?? span.service;
  const workload =
    pickInheritedAttr(span, ancestors, [
      "llm.call_site",
      "gen_ai.agent.name",
      "ai.telemetry.functionId",
    ]) ?? null;
  const ownReqModel =
    readSpanString(span.attributes, "gen_ai.request.model") ??
    readSpanString(span.attributes, "ai.model.id");
  const ancReqModel = pickAncestorAttr([...ancestors].reverse(), [
    "gen_ai.request.model",
  ]);
  const requestedModel = ownReqModel ?? ancReqModel ?? null;
  const responseModel =
    readSpanString(span.attributes, "gen_ai.response.model") ??
    readSpanString(span.attributes, "ai.response.model") ??
    requestedModel;
  const responseId =
    readSpanString(span.attributes, "gen_ai.response.id") ??
    readSpanString(span.attributes, "ai.response.id") ??
    null;
  const finishReasons = readSpanStringArray(
    span.attributes,
    "gen_ai.response.finish_reasons",
  );
  const singleFinish = readSpanString(
    span.attributes,
    "ai.response.finishReason",
  );
  if (singleFinish !== undefined && finishReasons.length === 0) {
    finishReasons.push(singleFinish);
  }
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    spanName: span.name,
    service,
    workload,
    provider,
    requestedModel,
    responseModel,
    responseId,
    finishReasons,
    startedAtMs: span.startedAtMs,
    durationMs: span.durationMs,
    status: span.status,
    errorMessage: span.statusMessage,
    ...extractUsageTokens(span),
    archiveKey: span.archiveKey,
    ownReqModel: ancReqModel ?? ownReqModel,
  };
}

function buildClaudeAgentItem(
  span: CodexCandidateSpan,
  base: LeafBaseFields,
): TrajectoryItem {
  const { ownReqModel: _unused, ...common } = base;
  return buildClaudeAgentTrajectoryItem({
    common,
    sessionId:
      readSpanString(span.attributes, "llm.claude_code.session_id") ??
      base.responseId,
    numTurns: readSpanNumber(span.attributes, "llm.claude_code.num_turns"),
    notionalCost: readSpanNumber(span.attributes, "llm.cost_usd"),
    rawOptions: span.attributes["llm.claude_code.options"],
    rawInput: readSpanBodyValue(span, "gen_ai.input.messages"),
    rawOutput: readSpanBodyValue(span, "gen_ai.output.messages"),
  });
}

function buildEmbedTrajectoryItem(
  span: CodexCandidateSpan,
  ancestors: readonly CodexCandidateSpan[],
  base: LeafBaseFields,
): TrajectoryItem {
  const { ownReqModel, ...common } = base;
  const summary = extractEmbeddingSummary({
    rawValue: pickInheritedBody(span, ancestors, "ai.value"),
    rawValues: pickInheritedBody(span, ancestors, "ai.values"),
    rawEmbedding: pickInheritedBody(span, ancestors, "ai.embedding"),
    rawEmbeddings: pickInheritedBody(span, ancestors, "ai.embeddings"),
    explicitDimensions: readSpanNumber(
      span.attributes,
      "gen_ai.embeddings.dimension.count",
    ),
  });
  const catalogId = resolveCatalogModelId(base.provider, [
    ownReqModel,
    base.requestedModel,
    base.responseModel,
  ]);
  const cost =
    catalogId === undefined
      ? undefined
      : costForTextUsage(catalogId, {
          inputTokens: base.inputTokens,
          outputTokens: base.outputTokens,
        });
  return {
    ...common,
    shape: "ai-sdk-embed",
    catalogCostUsd: cost ?? null,
    costKind: cost === undefined ? "none" : "metered",
    ...summary,
  };
}

function computeChatCost(
  base: LeafBaseFields,
  catalogId: string | undefined,
): number | undefined {
  if (catalogId === undefined) {
    return undefined;
  }
  return base.provider.startsWith("anthropic")
    ? costForTextUsage(catalogId, {
        inputTokens: base.inputTokens,
        outputTokens: base.outputTokens,
        cacheReadTokens: base.cachedInputTokens,
        cacheWriteTokens: base.cacheCreationTokens,
      })
    : costForTextUsage(catalogId, {
        inputTokens: base.inputTokens,
        outputTokens: base.outputTokens,
        cachedInputTokens: base.cachedInputTokens,
        cacheWriteTokens: base.cacheCreationTokens,
      });
}

export function buildLeafTrajectoryItem(
  span: CodexCandidateSpan,
  ancestors: readonly CodexCandidateSpan[],
): TrajectoryItem {
  const base = buildBaseLeafFields(span, ancestors);
  if (
    base.provider === "claude_code_sdk" ||
    span.attributes["llm.claude_code.session_id"] !== undefined ||
    span.attributes["llm.claude_code.num_turns"] !== undefined
  ) {
    return buildClaudeAgentItem(span, base);
  }
  if (isEmbedSpan(span)) {
    return buildEmbedTrajectoryItem(span, ancestors, base);
  }

  const { ownReqModel, ...common } = base;
  const rawInputBody =
    pickInheritedBody(span, ancestors, "gen_ai.input.messages") ??
    pickInheritedBody(span, ancestors, "ai.prompt.messages") ??
    pickInheritedBody(span, ancestors, "ai.prompt");
  const rawSystemBody =
    pickInheritedBody(span, ancestors, "gen_ai.system_instructions") ??
    pickInheritedBody(span, ancestors, "ai.prompt.system");
  let systemInstructions = normalizeSystemInstructions(rawSystemBody);
  const parsedPromptObj = LooseRecordSchema.safeParse(
    safeJsonParse(rawInputBody),
  );
  if (
    systemInstructions === null &&
    parsedPromptObj.success &&
    parsedPromptObj.data["system"] !== undefined
  ) {
    systemInstructions = normalizeSystemInstructions(
      parsedPromptObj.data["system"],
    );
  }

  const decisionPayload = tryParseDecisionInputPayload(rawInputBody);
  if (decisionPayload !== null) {
    return buildOpenAiDecisionTrajectoryItem({
      common,
      catalogId: resolveCatalogModelId("openai", [
        ownReqModel,
        base.requestedModel,
        base.responseModel,
      ]),
      systemInstructions,
      payload: decisionPayload,
      rawOutput: readSpanBodyValue(span, "gen_ai.output.messages"),
    });
  }

  const catalogId = resolveCatalogModelId(base.provider, [
    ownReqModel,
    base.requestedModel,
    base.responseModel,
  ]);
  const cost = computeChatCost(base, catalogId);
  const rawTools =
    pickInheritedBody(span, ancestors, "gen_ai.input.tools") ??
    pickInheritedBody(span, ancestors, "ai.prompt.tools");
  const rawOutputBody = readSpanBodyValue(span, "gen_ai.output.messages");
  const outputMessages =
    rawOutputBody === undefined
      ? buildLegacyAiSdkOutputMessages({
          responseText: readSpanBodyValue(span, "ai.response.text"),
          responseObject: readSpanBodyValue(span, "ai.response.object"),
          responseToolCalls: readSpanBodyValue(span, "ai.response.toolCalls"),
        })
      : parseTrajectoryMessages(rawOutputBody, "assistant");

  return {
    ...common,
    shape: "ai-sdk-chat",
    catalogCostUsd: cost ?? null,
    costKind:
      cost === undefined && base.provider === "unknown" ? "none" : "metered",
    systemInstructions,
    toolsJson: rawTools === undefined ? null : stringifyJson(rawTools),
    messages: parseTrajectoryMessages(rawInputBody, "user"),
    outputMessages,
    isRepairAttempt: hasExplicitRepairSignal(span),
  };
}
