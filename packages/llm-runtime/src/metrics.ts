import type {
  EmbeddingModelCallEndEvent,
  EmbeddingModelCallStartEvent,
  LanguageModelCallEndEvent,
  LanguageModelCallStartEvent,
  Telemetry,
} from "ai";
import { costForTextUsage, type Provider } from "@shepherdjerred/llm-models";
import {
  commonLlmMetrics,
  type CommonLlmMetrics,
} from "@shepherdjerred/llm-observability/metrics";
import { Counter, type Registry } from "prom-client";
import { parseNativeUsage } from "./usage.ts";
import {
  logLlmCallFailure,
  logLlmResponse,
  normalizeProvider,
  stableModelId,
} from "./logging.ts";
import type { LlmRuntimeLogger } from "./types.ts";

type RuntimeMetrics = CommonLlmMetrics & {
  structuredAttempts: Counter<"service" | "workload" | "model" | "outcome">;
};

const metricsByRegister = new WeakMap<Registry, RuntimeMetrics>();

export function runtimeMetrics(
  register: Registry | undefined,
): RuntimeMetrics | undefined {
  if (register === undefined) return undefined;
  const existing = metricsByRegister.get(register);
  if (existing !== undefined) return existing;

  const metrics: RuntimeMetrics = {
    ...commonLlmMetrics(register),
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

/**
 * Records metrics and the correlated success/failure log for one logical call.
 *
 * This is now the single source for both. Under the gateway, metrics came from
 * the telemetry integration while logging came from a fetch wrapper that read
 * the raw response body, and the two could disagree. Providers report
 * everything we need through the SDK's own usage, so one observer covers it.
 */
export class LlmMetricsTelemetry implements Telemetry {
  readonly #metrics: RuntimeMetrics | undefined;
  readonly #service: string;
  readonly #workload: string;
  readonly #logger: LlmRuntimeLogger;
  readonly #traceId: string | undefined;
  readonly #embedStartedAt = new Map<string, number>();
  #startedAt: number | undefined;
  #model: string | undefined;
  #provider: Provider | "unknown" = "unknown";
  #languageModelCallSucceeded = false;
  #operation: "language" | "embedding" | undefined;

  constructor(options: {
    metrics: RuntimeMetrics | undefined;
    service: string;
    workload: string;
    logger: LlmRuntimeLogger;
    traceId: string | undefined;
  }) {
    this.#metrics = options.metrics;
    this.#service = options.service;
    this.#workload = options.workload;
    this.#logger = options.logger;
    this.#traceId = options.traceId;
  }

  onLanguageModelCallStart(event: LanguageModelCallStartEvent): void {
    this.remember(event.provider, event.modelId);
    this.#startedAt = performance.now();
    this.#languageModelCallSucceeded = false;
    this.#operation = "language";
  }

  onLanguageModelCallEnd(event: LanguageModelCallEndEvent): void {
    this.#languageModelCallSucceeded = true;
    this.remember(event.provider, event.modelId);

    const provider = normalizeProvider(event.provider);
    const metadata = parseNativeUsage({
      requestedModel: stableModelId(provider, event.modelId),
      provider,
      responseId: event.responseId,
      resolvedModel: event.modelId,
      usage: event.usage,
    });

    logLlmResponse({
      logger: this.#logger,
      service: this.#service,
      workload: this.#workload,
      metadata,
      traceId: this.#traceId,
      durationMs: event.performance.responseTimeMs,
    });

    const metrics = this.#metrics;
    if (metrics === undefined) return;
    const labels = {
      service: this.#service,
      workload: this.#workload,
      provider,
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
      { ...labels, type: "cache_write" },
      metadata.tokens.cacheWrite,
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
    this.remember(event.provider, event.modelId);
    this.#startedAt ??= performance.now();
    this.#embedStartedAt.set(event.embedCallId, performance.now());
    this.#operation = "embedding";
  }

  onEmbedEnd(event: EmbeddingModelCallEndEvent): void {
    this.remember(event.provider, event.modelId);
    const metrics = this.#metrics;
    if (metrics === undefined) return;
    const provider = normalizeProvider(event.provider);
    const model = stableModelId(provider, event.modelId);
    const labels = {
      service: this.#service,
      workload: this.#workload,
      provider,
      model,
    };
    metrics.requests.inc({ ...labels, outcome: "success" });
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
      provider: this.#provider,
      model: this.#model ?? "unknown",
      outcome: "error",
    });
    logLlmCallFailure({
      logger: this.#logger,
      service: this.#service,
      workload: this.#workload,
      provider: this.#provider,
      model: this.#model ?? "unknown",
      traceId: this.#traceId,
      durationMs:
        this.#startedAt === undefined
          ? undefined
          : performance.now() - this.#startedAt,
      error,
    });
  }

  private remember(sdkProvider: string, routeModelId: string): void {
    const provider = normalizeProvider(sdkProvider);
    if (this.#provider === "unknown") this.#provider = provider;
    const model = stableModelId(provider, routeModelId);
    if (this.#model === undefined) this.#model = model;
    else if (this.#model !== model) this.#model = "multiple";
  }
}

export type RuntimeMetricsHandle = RuntimeMetrics;
