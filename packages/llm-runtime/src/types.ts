import type { OpenRouterEndpoint } from "@shepherdjerred/llm-models";
import type { Registry } from "prom-client";
import type { z } from "zod";

export type RuntimeFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

export type OpenRouterRuntimeLogRecord = {
  level: "info" | "error";
  event: "llm.openrouter.response" | "llm.openrouter.call_failed";
  message: string;
  service: string;
  workload: string;
  model: string;
  resolvedModel?: string | undefined;
  upstreamProvider?: string | undefined;
  isByok?: boolean | undefined;
  generationId?: string | undefined;
  route?: string | undefined;
  region?: string | undefined;
  fallbackAttempts: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  actualCostUsd?: number | undefined;
  catalogCostUsd?: number | undefined;
  upstreamCostUsd?: number | undefined;
  traceId?: string | undefined;
  outcome: "success" | "error";
  responseStatus?: number | undefined;
  durationMs?: number | undefined;
  errorType?: string | undefined;
};

export type OpenRouterRuntimeLogger = (
  record: OpenRouterRuntimeLogRecord,
) => void;

export const REQUIRED_MODEL_CAPABILITIES = [
  "tools",
  "structuredOutputs",
  "webSearch",
  "reasoning",
] as const;

/**
 * Worst-case number of billable generations one `generateValidatedObject` call
 * can issue. A caller that reserves budget before the call must reserve for all
 * of them, not for the first attempt alone.
 */
export const MAX_SEMANTIC_ATTEMPTS = 3;

/**
 * Upper bound on the characters a semantic retry appends to the caller's
 * prompt: the fixed corrective preamble plus the truncated issue summary.
 * Callers size a retry's input estimate with this.
 */
export const MAX_CORRECTIVE_PROMPT_CHARS = 1400;

export type RequiredModelCapability =
  (typeof REQUIRED_MODEL_CAPABILITIES)[number];

export type ModelRequirements = {
  endpoint: OpenRouterEndpoint;
  capabilities?: readonly RequiredModelCapability[] | undefined;
};

export type OpenRouterRuntimeOptions = {
  apiKey: string;
  service: string;
  appName: string;
  metricsRegister?: Registry | undefined;
  fetch?: RuntimeFetch | undefined;
  logger?: OpenRouterRuntimeLogger | undefined;
};

export type RuntimeTraceContext = {
  traceId?: string | undefined;
  parentSpanId?: string | undefined;
  traceName?: string | undefined;
};

export type CallOptionsInput = {
  workload: string;
  sessionId?: string | undefined;
  traceContext?: RuntimeTraceContext | undefined;
  observationId?: string | undefined;
};

/**
 * The AI SDK's normalized usage shape: `input` counts every prompt token
 * including cache reads, `cachedInput` is the cache-read subset of it, and
 * `cacheWrite` counts cache-creation tokens the upstream reports separately.
 */
export type OpenRouterTokenBreakdown = {
  input: number;
  output: number;
  cachedInput: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
};

export type OpenRouterRouterAttempt = {
  provider: string;
  model: string;
  status: number;
};

export type OpenRouterCallMetadata = {
  generationId?: string | undefined;
  requestedModel: string;
  resolvedModel?: string | undefined;
  upstreamProvider?: string | undefined;
  isByok?: boolean | undefined;
  route?: string | undefined;
  region?: string | undefined;
  fallbackAttempts: number;
  attempts: readonly OpenRouterRouterAttempt[];
  tokens: OpenRouterTokenBreakdown;
  actualCostUsd?: number | undefined;
  catalogCostUsd?: number | undefined;
  upstreamCostUsd?: number | undefined;
  routerMetadataPresent: boolean;
};

export type StructuredOutputAttempt = {
  attempt: number;
  outcome: "success" | "semantic-error" | "transport-error";
  issueSummary?: string | undefined;
  error?: string | undefined;
  usage: OpenRouterTokenBreakdown;
  metadata?: OpenRouterCallMetadata | undefined;
  finishReason?: string | undefined;
  generatedText?: string | undefined;
};

export type AggregateOpenRouterUsage = {
  tokens: OpenRouterTokenBreakdown;
  actualCostUsd: number;
  catalogCostUsd: number;
  upstreamCostUsd: number;
};

export type GenerateValidatedObjectInput<SCHEMA extends z.ZodType> = {
  model: string;
  schema: SCHEMA;
  schemaName: string;
  schemaDescription?: string | undefined;
  system?: string | undefined;
  prompt: string;
  workload: string;
  sessionId?: string | undefined;
  traceContext?: RuntimeTraceContext | undefined;
  abortSignal?: AbortSignal | undefined;
  maxOutputTokens?: number | undefined;
  semanticRetryMaxOutputTokens?: number | undefined;
  seed?: number | undefined;
  reasoningEffort?:
    "xhigh" | "high" | "medium" | "low" | "minimal" | "none" | undefined;
};

export type GenerateValidatedObjectResult<SCHEMA extends z.ZodType> = {
  object: z.output<SCHEMA>;
  usage: AggregateOpenRouterUsage;
  metadata: readonly OpenRouterCallMetadata[];
  attempts: readonly StructuredOutputAttempt[];
};

/**
 * Base for structured-output failures that already consumed billable tokens.
 * Callers that meter budgets must charge `usage` for these errors even though
 * no object was produced.
 */
export class StructuredOutputUsageError extends Error {
  readonly attempts: readonly StructuredOutputAttempt[];
  readonly usage: AggregateOpenRouterUsage;

  constructor(
    message: string,
    attempts: readonly StructuredOutputAttempt[],
    usage: AggregateOpenRouterUsage,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StructuredOutputUsageError";
    this.attempts = attempts;
    this.usage = usage;
  }
}

export class StructuredOutputExhaustionError extends StructuredOutputUsageError {
  constructor(
    message: string,
    attempts: readonly StructuredOutputAttempt[],
    usage: AggregateOpenRouterUsage,
  ) {
    super(message, attempts, usage);
    this.name = "StructuredOutputExhaustionError";
  }
}

/**
 * A provider-call failure — transport (429/5xx/network) or immediate API
 * (400–404) — that interrupted the semantic retry loop after at least one
 * earlier attempt already billed tokens. The original error is preserved as
 * `cause`; retry classification that inspects the transport layer should
 * unwrap it. A failure on the FIRST attempt is rethrown raw instead, since
 * nothing billable preceded it.
 */
export class StructuredOutputTransportError extends StructuredOutputUsageError {
  constructor(
    message: string,
    attempts: readonly StructuredOutputAttempt[],
    usage: AggregateOpenRouterUsage,
    options?: ErrorOptions,
  ) {
    super(message, attempts, usage, options);
    this.name = "StructuredOutputTransportError";
  }
}
