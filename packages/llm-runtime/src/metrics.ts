import type {
  EmbeddingModelCallEndEvent,
  EmbeddingModelCallStartEvent,
  LanguageModelCallEndEvent,
  LanguageModelCallStartEvent,
  Telemetry,
} from "ai";
import {
  costForTextUsage,
  modelIdForOpenRouterRoute,
} from "@shepherdjerred/llm-models";
import {
  commonLlmMetrics,
  type CommonLlmMetrics,
} from "@shepherdjerred/llm-observability/metrics";
import { Counter, type Registry } from "prom-client";
import { parseOpenRouterMetadata } from "./metadata.ts";
import { logOpenRouterCallFailure } from "./logging.ts";
import type { OpenRouterRuntimeLogger } from "./types.ts";

type RuntimeMetrics = CommonLlmMetrics & {
  routerAttempts: Counter<
    "service" | "workload" | "model" | "upstream_provider" | "outcome"
  >;
  metadataMissing: Counter<"service" | "workload" | "model">;
  structuredAttempts: Counter<"service" | "workload" | "model" | "outcome">;
};

const metricsByRegister = new WeakMap<Registry, RuntimeMetrics>();

function stableModelId(modelId: string): string {
  return modelIdForOpenRouterRoute(modelId) ?? modelId;
}

export function recordRouterResponse(
  metrics: RuntimeMetrics | undefined,
  input: {
    service: string;
    workload: string;
    requestedModel: string | undefined;
    responseBody: unknown;
    responseStatus: number | undefined;
    durationMs: number;
    endpoint: "language" | "embedding" | "image" | "unknown";
  },
): void {
  const model = stableModelId(input.requestedModel ?? "unknown");
  const metadata = parseOpenRouterMetadata({
    requestedModel: model,
    responseBody: input.responseBody,
  });
  if (metrics === undefined) return;
  const successful =
    input.responseStatus !== undefined &&
    input.responseStatus >= 200 &&
    input.responseStatus < 400;
  // OpenRouter currently emits router metadata only on completion routes, not
  // embeddings or images. Do not turn unsupported endpoints into false alerts.
  if (
    successful &&
    input.endpoint === "language" &&
    !metadata.routerMetadataPresent
  ) {
    metrics.metadataMissing.inc({
      service: input.service,
      workload: input.workload,
      model,
    });
  }
  for (const attempt of metadata.attempts) {
    metrics.routerAttempts.inc({
      service: input.service,
      workload: input.workload,
      model,
      upstream_provider: attempt.provider,
      outcome:
        attempt.status >= 200 && attempt.status < 300 ? "success" : "error",
    });
  }
  const labels = {
    service: input.service,
    workload: input.workload,
    provider: "openrouter",
    model,
  };
  if (successful && metadata.actualCostUsd !== undefined) {
    metrics.cost.inc({ ...labels, type: "actual" }, metadata.actualCostUsd);
  }
  if (successful && metadata.upstreamCostUsd !== undefined) {
    metrics.cost.inc({ ...labels, type: "upstream" }, metadata.upstreamCostUsd);
  }
  // Everything below is the *common* LLM request instrumentation, and for
  // language and embedding calls `OpenRouterMetricsTelemetry` already records
  // it from the AI SDK's own call-end events (`onLanguageModelCallEnd`,
  // `onEmbedEnd`). Recording it here as well would double every
  // `llm_requests_total`, `llm_request_duration_seconds`, and
  // `llm_tokens_total` for the two most common endpoints. Image generation has
  // no AI SDK telemetry event, so this fetch observer is its only source — that
  // is what this branch exists for, not an oversight. Router attempts, missing
  // metadata, and actual/upstream cost above are OpenRouter-specific and are
  // recorded for every endpoint.
  if (input.endpoint !== "image") return;
  metrics.requests.inc({
    ...labels,
    outcome: successful ? "success" : "error",
  });
  metrics.duration.observe(labels, input.durationMs / 1000);
  if (!successful) return;
  metrics.tokens.inc({ ...labels, type: "input" }, metadata.tokens.input);
  metrics.tokens.inc({ ...labels, type: "output" }, metadata.tokens.output);
  metrics.tokens.inc(
    { ...labels, type: "cached_input" },
    metadata.tokens.cachedInput,
  );
  metrics.tokens.inc(
    { ...labels, type: "reasoning" },
    metadata.tokens.reasoning,
  );
  if (metadata.catalogCostUsd !== undefined) {
    metrics.cost.inc({ ...labels, type: "catalog" }, metadata.catalogCostUsd);
  }
}

export function runtimeMetrics(
  register: Registry | undefined,
): RuntimeMetrics | undefined {
  if (register === undefined) return undefined;
  const existing = metricsByRegister.get(register);
  if (existing !== undefined) return existing;

  const metrics: RuntimeMetrics = {
    ...commonLlmMetrics(register),
    routerAttempts: new Counter({
      name: "llm_router_attempts_total",
      help: "OpenRouter upstream routing attempts.",
      labelNames: [
        "service",
        "workload",
        "model",
        "upstream_provider",
        "outcome",
      ],
      registers: [register],
    }),
    metadataMissing: new Counter({
      name: "llm_openrouter_metadata_missing_total",
      help: "Successful OpenRouter calls without router metadata.",
      labelNames: ["service", "workload", "model"],
      registers: [register],
    }),
    structuredAttempts: new Counter({
      name: "llm_structured_output_attempts_total",
      help: "Structured output semantic attempts by outcome.",
      labelNames: ["service", "workload", "model", "outcome"],
      registers: [register],
    }),
  };
  metricsByRegister.set(register, metrics);
  return metrics;
}

export class OpenRouterMetricsTelemetry implements Telemetry {
  readonly #metrics: RuntimeMetrics | undefined;
  readonly #service: string;
  readonly #workload: string;
  readonly #logger: OpenRouterRuntimeLogger;
  readonly #traceId: string | undefined;
  readonly #embedStartedAt = new Map<string, number>();
  #startedAt: number | undefined;
  #model: string | undefined;
  #languageModelCallSucceeded = false;
  #operation: "language" | "embedding" | undefined;

  constructor(options: {
    metrics: RuntimeMetrics | undefined;
    service: string;
    workload: string;
    logger: OpenRouterRuntimeLogger;
    traceId: string | undefined;
  }) {
    this.#metrics = options.metrics;
    this.#service = options.service;
    this.#workload = options.workload;
    this.#logger = options.logger;
    this.#traceId = options.traceId;
  }

  onLanguageModelCallStart(event: LanguageModelCallStartEvent): void {
    this.rememberModel(event.modelId);
    this.#startedAt = performance.now();
    this.#languageModelCallSucceeded = false;
    this.#operation = "language";
  }

  onLanguageModelCallEnd(event: LanguageModelCallEndEvent): void {
    this.#languageModelCallSucceeded = true;
    this.rememberModel(event.modelId);
    const metrics = this.#metrics;
    if (metrics === undefined) return;
    const metadata = parseOpenRouterMetadata({
      requestedModel: stableModelId(event.modelId),
      responseId: event.responseId,
      resolvedModel: event.modelId,
      usage: event.usage,
      providerMetadata: event.providerMetadata,
    });
    const labels = {
      service: this.#service,
      workload: this.#workload,
      provider: "openrouter",
      model: metadata.requestedModel,
    };
    metrics.requests.inc({ ...labels, outcome: "success" });
    metrics.duration.observe(labels, event.performance.responseTimeMs / 1000);
    metrics.tokens.inc({ ...labels, type: "input" }, metadata.tokens.input);
    metrics.tokens.inc({ ...labels, type: "output" }, metadata.tokens.output);
    metrics.tokens.inc(
      { ...labels, type: "cached_input" },
      metadata.tokens.cachedInput,
    );
    metrics.tokens.inc(
      { ...labels, type: "reasoning" },
      metadata.tokens.reasoning,
    );
    if (metadata.catalogCostUsd !== undefined) {
      metrics.cost.inc({ ...labels, type: "catalog" }, metadata.catalogCostUsd);
    }
  }

  onEmbedStart(event: EmbeddingModelCallStartEvent): void {
    this.rememberModel(event.modelId);
    this.#startedAt ??= performance.now();
    this.#embedStartedAt.set(event.embedCallId, performance.now());
    this.#operation = "embedding";
  }

  onEmbedEnd(event: EmbeddingModelCallEndEvent): void {
    this.rememberModel(event.modelId);
    const metrics = this.#metrics;
    if (metrics === undefined) return;
    const model = stableModelId(event.modelId);
    const labels = {
      service: this.#service,
      workload: this.#workload,
      provider: "openrouter",
      model,
    };
    metrics.requests.inc({
      ...labels,
      outcome: "success",
    });
    const startedAt = this.#embedStartedAt.get(event.embedCallId);
    this.#embedStartedAt.delete(event.embedCallId);
    if (startedAt !== undefined) {
      metrics.duration.observe(labels, (performance.now() - startedAt) / 1000);
    }
    metrics.tokens.inc({ ...labels, type: "input" }, event.usage.tokens);
    const catalogCostUsd = costForTextUsage(model, {
      inputTokens: event.usage.tokens,
      outputTokens: 0,
    });
    if (catalogCostUsd !== undefined) {
      metrics.cost.inc({ ...labels, type: "catalog" }, catalogCostUsd);
    }
  }

  onError(error: unknown): void {
    if (this.#operation === "language" && this.#languageModelCallSucceeded) {
      return;
    }
    this.#metrics?.requests.inc({
      service: this.#service,
      workload: this.#workload,
      provider: "openrouter",
      model: this.#model ?? "unknown",
      outcome: "error",
    });
    logOpenRouterCallFailure({
      logger: this.#logger,
      service: this.#service,
      workload: this.#workload,
      model: this.#model ?? "unknown",
      traceId: this.#traceId,
      durationMs:
        this.#startedAt === undefined
          ? undefined
          : performance.now() - this.#startedAt,
      error,
    });
  }

  private rememberModel(routeModelId: string): void {
    const model = stableModelId(routeModelId);
    if (this.#model === undefined) this.#model = model;
    else if (this.#model !== model) this.#model = "multiple";
  }
}

export type RuntimeMetricsHandle = RuntimeMetrics;
