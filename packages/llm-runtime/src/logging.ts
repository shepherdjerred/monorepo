import { modelIdForOpenRouterRoute } from "@shepherdjerred/llm-models";
import { z } from "zod";
import type { AttributedResponseObservation } from "./attributed-fetch.ts";
import { parseOpenRouterMetadata } from "./metadata.ts";
import type {
  OpenRouterRuntimeLogger,
  OpenRouterRuntimeLogRecord,
} from "./types.ts";

const TelemetryErrorSchema = z.object({ error: z.unknown() }).loose();
const ErrorNameSchema = z.object({ name: z.string() }).loose();

export const defaultOpenRouterRuntimeLogger: OpenRouterRuntimeLogger = (
  record,
) => {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...record,
  });
  if (record.level === "error") globalThis.console.error(line);
  else globalThis.console.info(line);
};

function stableModelId(modelId: string | undefined): string {
  if (modelId === undefined) return "unknown";
  return modelIdForOpenRouterRoute(modelId) ?? modelId;
}

export function logOpenRouterResponse(input: {
  logger: OpenRouterRuntimeLogger;
  observation: AttributedResponseObservation;
  service: string;
}): void {
  const metadata = parseOpenRouterMetadata({
    requestedModel: stableModelId(input.observation.requestedModel),
    responseBody: input.observation.responseBody,
  });
  const outcome =
    input.observation.responseStatus !== undefined &&
    input.observation.responseStatus >= 200 &&
    input.observation.responseStatus < 400
      ? "success"
      : "error";
  input.logger({
    level: outcome === "success" ? "info" : "error",
    event: "llm.openrouter.response",
    message: "OpenRouter gateway response",
    service: input.service,
    workload: input.observation.workload,
    model: metadata.requestedModel,
    resolvedModel: metadata.resolvedModel,
    upstreamProvider: metadata.upstreamProvider,
    generationId: metadata.generationId,
    route: metadata.route,
    region: metadata.region,
    fallbackAttempts: metadata.fallbackAttempts,
    inputTokens: metadata.tokens.input,
    outputTokens: metadata.tokens.output,
    cachedInputTokens: metadata.tokens.cachedInput,
    cacheWriteTokens: metadata.tokens.cacheWrite,
    reasoningTokens: metadata.tokens.reasoning,
    totalTokens: metadata.tokens.total,
    actualCostUsd: metadata.actualCostUsd,
    catalogCostUsd: metadata.catalogCostUsd,
    upstreamCostUsd: metadata.upstreamCostUsd,
    traceId: input.observation.traceId,
    outcome,
    responseStatus: input.observation.responseStatus,
    durationMs: input.observation.durationMs,
  });
}

export function logOpenRouterCallFailure(input: {
  logger: OpenRouterRuntimeLogger;
  service: string;
  workload: string;
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
  const record: OpenRouterRuntimeLogRecord = {
    level: "error",
    event: "llm.openrouter.call_failed",
    message: "OpenRouter call failed",
    service: input.service,
    workload: input.workload,
    model: stableModelId(input.model),
    fallbackAttempts: 0,
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
