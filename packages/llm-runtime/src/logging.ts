import {
  modelIdForNativeRoute,
  type Provider,
} from "@shepherdjerred/llm-models";
import { z } from "zod";
import type {
  LlmCallMetadata,
  LlmRuntimeLogger,
  LlmRuntimeLogRecord,
} from "./types.ts";

const TelemetryErrorSchema = z.object({ error: z.unknown() }).loose();
const ErrorNameSchema = z.object({ name: z.string() }).loose();

export const defaultLlmRuntimeLogger: LlmRuntimeLogger = (record) => {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...record,
  });
  if (record.level === "error") globalThis.console.error(line);
  else globalThis.console.info(line);
};

/**
 * Map an AI SDK provider name onto the catalog's provider enum.
 *
 * The SDK reports a qualified transport name — `anthropic.messages`,
 * `openai.chat`, `google.vertex.chat` — while the catalog, metric labels, and
 * pricing all key on the bare vendor.
 */
export function normalizeProvider(
  sdkProvider: string | undefined,
): Provider | "unknown" {
  if (sdkProvider?.startsWith("openai") === true) return "openai";
  if (sdkProvider?.startsWith("anthropic") === true) return "anthropic";
  return sdkProvider?.startsWith("google") === true ? "google" : "unknown";
}

/**
 * Resolve a provider's own model id back to the repository's stable catalog id,
 * falling back to the raw id when the route is unknown or ambiguous. An
 * unresolved id is recoverable; a confidently wrong one corrupts attribution.
 */
export function stableModelId(
  provider: Provider | "unknown",
  routeModelId: string | undefined,
): string {
  if (routeModelId === undefined) return "unknown";
  return provider === "unknown"
    ? routeModelId
    : (modelIdForNativeRoute(provider, routeModelId) ?? routeModelId);
}

export function logLlmResponse(input: {
  logger: LlmRuntimeLogger;
  service: string;
  workload: string;
  metadata: LlmCallMetadata;
  traceId: string | undefined;
  durationMs: number | undefined;
}): void {
  const { metadata } = input;
  input.logger({
    level: "info",
    event: "llm.provider.response",
    message: "LLM provider response",
    service: input.service,
    workload: input.workload,
    provider: metadata.provider,
    model: metadata.requestedModel,
    resolvedModel: metadata.resolvedModel,
    responseId: metadata.responseId,
    serviceTier: metadata.serviceTier,
    inputTokens: metadata.tokens.input,
    outputTokens: metadata.tokens.output,
    cachedInputTokens: metadata.tokens.cachedInput,
    cacheWriteTokens: metadata.tokens.cacheWrite,
    reasoningTokens: metadata.tokens.reasoning,
    totalTokens: metadata.tokens.total,
    catalogCostUsd: metadata.catalogCostUsd,
    traceId: input.traceId,
    outcome: "success",
    durationMs: input.durationMs,
  });
}

export function logLlmCallFailure(input: {
  logger: LlmRuntimeLogger;
  service: string;
  workload: string;
  provider: Provider | "unknown";
  model: string;
  traceId: string | undefined;
  durationMs: number | undefined;
  error: unknown;
}): void {
  const telemetryError = TelemetryErrorSchema.safeParse(input.error);
  const error = telemetryError.success
    ? telemetryError.data.error
    : input.error;
  const parsedError = ErrorNameSchema.safeParse(error);
  const record: LlmRuntimeLogRecord = {
    level: "error",
    event: "llm.provider.call_failed",
    message: "LLM provider call failed",
    service: input.service,
    workload: input.workload,
    provider: input.provider,
    model: input.model,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    traceId: input.traceId,
    outcome: "error",
    durationMs: input.durationMs,
    errorType: parsedError.success ? parsedError.data.name : typeof error,
  };
  input.logger(record);
}
