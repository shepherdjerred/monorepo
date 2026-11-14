import {
  decodeFields,
  fieldBytes,
  fieldBytesAll,
  fieldText,
  fieldVarint,
  type ProtoField,
} from "./antigravity-protobuf.ts";
import { modelNameFromId, normalizeModelName } from "./antigravity-models.ts";
import { type UsageCounts } from "@shepherdjerred/toolkit/lib/history/usage-cost.ts";

// Field numbers below are transcribed from ccusage's Rust adapter
// (`rust/adapters/antigravity/src/parser.rs`), the only known-correct
// decoding of Antigravity's undocumented local protobuf schema.

function decodeTimestamp(bytes: Uint8Array): number | null {
  const fields = decodeFields(bytes);
  const seconds = fieldVarint(fields, 1);
  if (seconds === undefined || seconds <= 0) {
    return null;
  }
  const nanos = Math.min(fieldVarint(fields, 2) ?? 0, 999_999_999);
  return seconds * 1000 + Math.floor(nanos / 1_000_000);
}

export function trajectoryTimestampMs(blob: Uint8Array): number | null {
  const fields = decodeFields(blob);
  const timestampBytes = fieldBytes(fields, 2);
  return timestampBytes === undefined ? null : decodeTimestamp(timestampBytes);
}

// Google Vertex, Google Gemini, Google "Evergreen".
const GOOGLE_PROVIDER_IDS: ReadonlySet<number> = new Set([3, 24, 30]);

function pricingCandidates(
  modelName: string,
  provider: number | undefined,
): readonly string[] {
  const candidates = [modelName];
  if (provider !== undefined && GOOGLE_PROVIDER_IDS.has(provider)) {
    candidates.push(
      `google/${modelName}`,
      `gemini/${modelName}`,
      `vertex_ai/${modelName}`,
      `openrouter/google/${modelName}`,
    );
  }
  return candidates;
}

export type UsageEvent = {
  readonly modelCandidates: readonly string[];
  readonly usage: UsageCounts;
};

function reconciledUsageCounts(raw: {
  readonly inputTokens: number;
  readonly totalOutputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly reasoningTokensRaw: number;
  readonly visibleOutputTokens: number;
}): UsageCounts | null {
  const allZero =
    raw.inputTokens === 0 &&
    raw.totalOutputTokens === 0 &&
    raw.cacheCreationTokens === 0 &&
    raw.cacheReadTokens === 0 &&
    raw.reasoningTokensRaw === 0 &&
    raw.visibleOutputTokens === 0;
  if (allZero) {
    return null;
  }
  // Gemini reports visible output and reasoning ("thoughts") as separate,
  // additive fields — unlike Codex/Grok, where the reported output count
  // already includes reasoning. `totalOutput` reconciles the two raw fields
  // into the true billable output count; `catalogCost` prices `outputTokens`
  // alone, so it must be that total, with `reasoningTokens` reported only as
  // an informational subset — never dropped from billing.
  const totalOutput = Math.max(
    raw.totalOutputTokens,
    raw.visibleOutputTokens + raw.reasoningTokensRaw,
  );
  const reasoningTokens = Math.min(raw.reasoningTokensRaw, totalOutput);
  return {
    inputTokens: raw.inputTokens,
    outputTokens: totalOutput,
    cacheReadTokens: raw.cacheReadTokens,
    cacheCreationTokens: raw.cacheCreationTokens,
    cachedInputTokens: 0,
    reasoningTokens,
  };
}

type ModelFallback = {
  readonly modelName: string | undefined;
  readonly provider: number | undefined;
};

function modelNameFromFields(
  fields: readonly ProtoField[],
  modelIdField: number,
  textFieldA: number,
  textFieldB: number,
): string | undefined {
  const text = fieldText(fields, textFieldA) ?? fieldText(fields, textFieldB);
  if (text !== undefined) {
    return text;
  }
  const modelId = fieldVarint(fields, modelIdField);
  return modelId !== undefined && modelId !== 0
    ? modelNameFromId(modelId)
    : undefined;
}

/**
 * Decode one `ModelUsage` submessage into a usage event. `preferOwnModelId`
 * is true only for retry attempts: a retry's own `model_id` can legitimately
 * name a different (fallback) model than the generation's outer descriptor,
 * whereas the primary usage's own `model_id` always matches the outer
 * descriptor when both are present (verified against real local data), so
 * the outer text name — more precise than the numeric id table — wins there.
 */
function usageEventFromModelUsage(
  bytes: Uint8Array,
  fallback: ModelFallback,
  preferOwnModelId: boolean,
): UsageEvent | null {
  const fields = decodeFields(bytes);
  const usageModelId = fieldVarint(fields, 1);
  const ownModelName =
    usageModelId !== undefined && usageModelId !== 0
      ? modelNameFromId(usageModelId)
      : undefined;
  const rawModelName = preferOwnModelId
    ? (ownModelName ?? fallback.modelName)
    : (fallback.modelName ?? ownModelName);
  const modelName =
    rawModelName === undefined ? "unknown" : normalizeModelName(rawModelName);

  const provider = fieldVarint(fields, 6);
  const effectiveProvider =
    provider !== undefined && provider !== 0 ? provider : fallback.provider;

  const usage = reconciledUsageCounts({
    inputTokens: fieldVarint(fields, 2) ?? 0,
    totalOutputTokens: fieldVarint(fields, 3) ?? 0,
    cacheCreationTokens: fieldVarint(fields, 4) ?? 0,
    cacheReadTokens: fieldVarint(fields, 5) ?? 0,
    reasoningTokensRaw: fieldVarint(fields, 9) ?? 0,
    visibleOutputTokens: fieldVarint(fields, 10) ?? 0,
  });
  if (usage === null) {
    return null;
  }
  return {
    modelCandidates: pricingCandidates(modelName, effectiveProvider),
    usage,
  };
}

export type GenerationRowResult = {
  readonly events: readonly UsageEvent[];
  readonly timestampMs: number | null;
};

function eventsFromUsageAndRetries(
  usageBytes: Uint8Array | undefined,
  retryBytesList: readonly Uint8Array[],
  fallback: ModelFallback,
): UsageEvent[] {
  const events: UsageEvent[] = [];
  if (usageBytes !== undefined) {
    const event = usageEventFromModelUsage(usageBytes, fallback, false);
    if (event !== null) {
      events.push(event);
    }
  }
  for (const retryBytes of retryBytesList) {
    const retryUsageBytes = fieldBytes(decodeFields(retryBytes), 2);
    if (retryUsageBytes === undefined) {
      continue;
    }
    const event = usageEventFromModelUsage(retryUsageBytes, fallback, true);
    if (event !== null) {
      events.push(event);
    }
  }
  return events;
}

export function usageEventsFromGenMetadata(
  blob: Uint8Array,
  trajectoryFallbackMs: number | null,
): GenerationRowResult {
  const topFields = decodeFields(blob);
  const chatModelBytes = fieldBytes(topFields, 1);
  if (chatModelBytes === undefined) {
    return { events: [], timestampMs: trajectoryFallbackMs };
  }
  const chatModelFields = decodeFields(chatModelBytes);

  const fallback: ModelFallback = {
    modelName: modelNameFromFields(chatModelFields, 3, 19, 21),
    provider: undefined,
  };

  let timestampMs: number | null = null;
  const generationInfoBytes = fieldBytes(chatModelFields, 9);
  if (generationInfoBytes !== undefined) {
    const timestampBytes = fieldBytes(decodeFields(generationInfoBytes), 4);
    if (timestampBytes !== undefined) {
      timestampMs = decodeTimestamp(timestampBytes);
    }
  }
  timestampMs ??= trajectoryFallbackMs;

  const events = eventsFromUsageAndRetries(
    fieldBytes(chatModelFields, 4),
    fieldBytesAll(chatModelFields, 17),
    fallback,
  );
  return { events, timestampMs };
}

function stepModelFallback(fields: readonly ProtoField[]): ModelFallback {
  const modelInfoBytes = fieldBytes(fields, 24);
  if (modelInfoBytes === undefined) {
    return { modelName: undefined, provider: undefined };
  }
  const modelInfoFields = decodeFields(modelInfoBytes);
  const providerRaw = fieldVarint(modelInfoFields, 7);
  return {
    modelName: modelNameFromFields(modelInfoFields, 1, 12, 8),
    provider:
      providerRaw !== undefined && providerRaw !== 0 ? providerRaw : undefined,
  };
}

export function usageEventsFromStep(
  blob: Uint8Array,
  trajectoryFallbackMs: number | null,
): GenerationRowResult {
  const fields = decodeFields(blob);
  const fallback = stepModelFallback(fields);

  const timestampBytes = fieldBytes(fields, 8) ?? fieldBytes(fields, 1);
  const timestampMs =
    (timestampBytes === undefined ? null : decodeTimestamp(timestampBytes)) ??
    trajectoryFallbackMs;

  const events = eventsFromUsageAndRetries(
    fieldBytes(fields, 9),
    fieldBytesAll(fields, 28),
    fallback,
  );
  return { events, timestampMs };
}
