import type {
  CacheTtl,
  ModelEndpoint,
  Provider,
  ServiceTier,
} from "@shepherdjerred/llm-models";
import type { Registry } from "prom-client";
import type { z } from "zod";

export type RuntimeFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

export type LlmRuntimeLogRecord = {
  level: "info" | "error";
  event: "llm.provider.response" | "llm.provider.call_failed";
  message: string;
  service: string;
  workload: string;
  provider: Provider | "unknown";
  model: string;
  resolvedModel?: string | undefined;
  responseId?: string | undefined;
  serviceTier?: ServiceTier | undefined;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  catalogCostUsd?: number | undefined;
  traceId?: string | undefined;
  outcome: "success" | "error";
  responseStatus?: number | undefined;
  durationMs?: number | undefined;
  errorType?: string | undefined;
};

export type LlmRuntimeLogger = (record: LlmRuntimeLogRecord) => void;

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
  endpoint: ModelEndpoint;
  capabilities?: readonly RequiredModelCapability[] | undefined;
};

/**
 * How a workload proves it may call Anthropic.
 *
 * `federation` is what deployed workloads use: the pod presents a projected
 * Kubernetes service-account token and Anthropic returns a short-lived
 * `sk-ant-oat...`. `apiKey` exists for CI and local development, where no
 * projected token is available.
 */
export type AnthropicCredentials =
  | { readonly kind: "apiKey"; readonly apiKey: string }
  | {
      readonly kind: "federation";
      /** Path to the projected identity token; re-read on every exchange. */
      readonly identityTokenFile: string;
      readonly federationRuleId: string;
      readonly organizationId: string;
      readonly serviceAccountId: string;
      /** Required only when the rule spans more than one workspace. */
      readonly workspaceId?: string | undefined;
    };

/**
 * Google is reached through the Gemini API with a service-account-bound "auth
 * key", not Vertex. Vertex offers no hard spend cap without an invoiced Gemini
 * Enterprise account — newer Gemini models there run on Dynamic Shared Quota, so
 * there is no per-project quota to lower either — while the Gemini API has a
 * native per-project monthly cap. The price is a static key minted with gcloud
 * rather than federation.
 */
export type GoogleCredentials = {
  readonly apiKey: string;
};

export type ProviderCredentials = {
  readonly openai?: { readonly apiKey: string } | undefined;
  readonly anthropic?: AnthropicCredentials | undefined;
  readonly google?: GoogleCredentials | undefined;
};

export type LlmRuntimeOptions = {
  readonly credentials: ProviderCredentials;
  readonly service: string;
  readonly appName: string;
  readonly metricsRegister?: Registry | undefined;
  readonly fetch?: RuntimeFetch | undefined;
  readonly logger?: LlmRuntimeLogger | undefined;
};

export type RuntimeTraceContext = {
  traceId?: string | undefined;
  parentSpanId?: string | undefined;
  traceName?: string | undefined;
};

export type CallOptionsInput = {
  workload: string;
  /**
   * The catalog model this call targets. Optional, but supplying it lets the
   * runtime attach the provider-specific options that keep JSON schemas strict.
   */
  model?: string | undefined;
  sessionId?: string | undefined;
  /**
   * The provider prompt-cache partition. Requests share cached prefixes only
   * within one key, and without it the per-call session id partitions the
   * cache — so calls with a long common prefix but distinct sessions (one
   * per conversation turn) never reuse each other's cache. Set it to one
   * stable value per workload and prompt version.
   */
  promptCacheKey?: string | undefined;
  traceContext?: RuntimeTraceContext | undefined;
};

/**
 * The AI SDK's normalized usage shape, flattened.
 *
 * Every provider reports these as NON-OVERLAPPING quantities: `input` is the
 * uncached prompt tokens only, with `cachedInput` (reads) and `cacheWrite`
 * counted beside it. The SDK reconciles the two upstream conventions — OpenAI
 * reports cached tokens as a subset of its prompt total, Anthropic reports them
 * separately — so downstream code never has to know which provider it is
 * pricing.
 */
export type TokenBreakdown = {
  input: number;
  output: number;
  cachedInput: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
};

export type LlmCallMetadata = {
  responseId?: string | undefined;
  /** The repository's stable catalog id. */
  requestedModel: string;
  /** What the provider says it actually served. */
  resolvedModel?: string | undefined;
  provider: Provider | "unknown";
  /** Absent means the provider did not report a tier, which bills as standard. */
  serviceTier?: ServiceTier | undefined;
  /** Cache writes split by TTL, where the provider reports the split. */
  cacheWriteByTtl?: Partial<Record<CacheTtl, number>> | undefined;
  /** Server-side tools billed per request rather than per token. */
  serverToolRequests?: { webSearch: number } | undefined;
  tokens: TokenBreakdown;
  /**
   * Catalog-priced cost for this call. Undefined when the catalog cannot price
   * it honestly — an unpriced service tier or an unpriced billed tool — rather
   * than silently reporting a number that omits a charge.
   */
  catalogCostUsd?: number | undefined;
};

export type StructuredOutputAttempt = {
  attempt: number;
  outcome: "success" | "semantic-error" | "transport-error";
  issueSummary?: string | undefined;
  error?: string | undefined;
  usage: TokenBreakdown;
  metadata?: LlmCallMetadata | undefined;
  finishReason?: string | undefined;
  generatedText?: string | undefined;
};

export type AggregateLlmUsage = {
  tokens: TokenBreakdown;
  catalogCostUsd: number;
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
  usage: AggregateLlmUsage;
  metadata: readonly LlmCallMetadata[];
  attempts: readonly StructuredOutputAttempt[];
};

/**
 * Base for structured-output failures that already consumed billable tokens.
 * Callers that meter budgets must charge `usage` for these errors even though
 * no object was produced.
 */
export class StructuredOutputUsageError extends Error {
  readonly attempts: readonly StructuredOutputAttempt[];
  readonly usage: AggregateLlmUsage;

  constructor(
    message: string,
    attempts: readonly StructuredOutputAttempt[],
    usage: AggregateLlmUsage,
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
    usage: AggregateLlmUsage,
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
    usage: AggregateLlmUsage,
    options?: ErrorOptions,
  ) {
    super(message, attempts, usage, options);
    this.name = "StructuredOutputTransportError";
  }
}
