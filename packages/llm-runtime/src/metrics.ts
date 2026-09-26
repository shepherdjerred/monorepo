import type {
  EmbeddingModelCallEndEvent,
  EmbeddingModelCallStartEvent,
  ImageModel,
  ImageModelMiddleware,
  LanguageModelCallEndEvent,
  LanguageModelCallStartEvent,
  Telemetry,
} from "ai";
import {
  costForTextUsage,
  getPricing,
  type Provider,
} from "@shepherdjerred/llm-models";
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
import type { LlmCallMetadata, LlmRuntimeLogger } from "./types.ts";

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
    const provider = normalizeProvider(event.provider);
    if (provider === "unknown") {
      throw new Error(
        `Unsupported embedding model provider: ${event.provider}`,
      );
    }
    const model = stableModelId(provider, event.modelId);
    const labels = {
      service: this.#service,
      workload: this.#workload,
      provider,
      model,
    };
    const startedAt = this.#embedStartedAt.get(event.embedCallId);
    this.#embedStartedAt.delete(event.embedCallId);
    const durationMs =
      startedAt === undefined ? undefined : performance.now() - startedAt;
    const catalogCostUsd = costForTextUsage(model, {
      inputTokens: event.usage.tokens,
      outputTokens: 0,
    });

    logLlmResponse({
      logger: this.#logger,
      service: this.#service,
      workload: this.#workload,
      metadata: {
        requestedModel: model,
        resolvedModel: model,
        provider,
        tokens: {
          input: event.usage.tokens,
          output: 0,
          cachedInput: 0,
          cacheWrite: 0,
          reasoning: 0,
          total: event.usage.tokens,
        },
        ...(catalogCostUsd === undefined ? {} : { catalogCostUsd }),
      },
      traceId: this.#traceId,
      durationMs,
    });

    const metrics = this.#metrics;
    if (metrics === undefined) return;
    metrics.requests.inc({ ...labels, outcome: "success" });
    if (durationMs !== undefined) {
      metrics.duration.observe(labels, durationMs / 1000);
    }
    metrics.tokens.inc({ ...labels, type: "input" }, event.usage.tokens);
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

/**
 * Images do not use the AI SDK Telemetry integration, so they need their own
 * model middleware. It records provider outcomes and catalog-priced images at
 * the provider boundary, where the generated image count and resolved model
 * are available.
 */
export function imageMetricsMiddleware(options: {
  metrics: CommonLlmMetrics | undefined;
  service: string;
  workload: string;
  modelId: string;
  logger: LlmRuntimeLogger;
  traceId: string | undefined;
}): ImageModelMiddleware {
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, model }) => {
      const startedAt = performance.now();
      const provider = normalizeProvider(model.provider);
      if (provider === "unknown") {
        throw new Error(`Unsupported image model provider: ${model.provider}`);
      }
      const modelId = options.modelId;
      const labels = {
        service: options.service,
        workload: options.workload,
        provider,
        model: modelId,
      };

      let result: GeneratedImageResult;
      try {
        result = await doGenerate();
      } catch (error: unknown) {
        recordImageFailure({
          options,
          labels,
          provider,
          modelId,
          durationMs: performance.now() - startedAt,
          error,
        });
        throw error;
      }

      recordImageSuccess({
        options,
        labels,
        provider,
        modelId,
        result,
        durationMs: performance.now() - startedAt,
      });
      return result;
    },
  };
}

type GeneratedImageResult = Awaited<
  ReturnType<Extract<ImageModel, { specificationVersion: "v4" }>["doGenerate"]>
>;

function recordImageSuccess(input: {
  options: Parameters<typeof imageMetricsMiddleware>[0];
  labels: {
    service: string;
    workload: string;
    provider: Provider;
    model: string;
  };
  provider: Provider;
  modelId: string;
  result: GeneratedImageResult;
  durationMs: number;
}): void {
  const inputTokens = input.result.usage?.inputTokens ?? 0;
  const outputTokens = input.result.usage?.outputTokens ?? 0;
  const totalTokens =
    input.result.usage?.totalTokens ?? inputTokens + outputTokens;
  const pricing = getPricing(input.modelId);
  const catalogCostUsd =
    pricing?.modality === "image"
      ? pricing.perImage * input.result.images.length
      : undefined;

  input.options.metrics?.requests.inc({ ...input.labels, outcome: "success" });
  input.options.metrics?.duration.observe(
    input.labels,
    input.durationMs / 1000,
  );
  recordImageTokenMetrics(
    input.options.metrics,
    input.labels,
    input.result.usage,
  );
  if (catalogCostUsd !== undefined && input.result.images.length > 0) {
    input.options.metrics?.cost.inc(
      { ...input.labels, type: "catalog" },
      catalogCostUsd,
    );
  }

  const metadata: LlmCallMetadata = {
    requestedModel: input.modelId,
    resolvedModel: stableModelId(input.provider, input.result.response.modelId),
    provider: input.provider,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      cachedInput: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: totalTokens,
    },
    ...(catalogCostUsd === undefined ? {} : { catalogCostUsd }),
  };
  logLlmResponse({
    logger: input.options.logger,
    service: input.options.service,
    workload: input.options.workload,
    metadata,
    traceId: input.options.traceId,
    durationMs: input.durationMs,
  });
}

function recordImageTokenMetrics(
  metrics: CommonLlmMetrics | undefined,
  labels: {
    service: string;
    workload: string;
    provider: Provider;
    model: string;
  },
  usage: GeneratedImageResult["usage"],
): void {
  if (usage?.inputTokens !== undefined) {
    metrics?.tokens.inc({ ...labels, type: "input" }, usage.inputTokens);
  }
  if (usage?.outputTokens !== undefined) {
    metrics?.tokens.inc({ ...labels, type: "output" }, usage.outputTokens);
  }
}

function recordImageFailure(input: {
  options: Parameters<typeof imageMetricsMiddleware>[0];
  labels: {
    service: string;
    workload: string;
    provider: Provider;
    model: string;
  };
  provider: Provider;
  modelId: string;
  durationMs: number;
  error: unknown;
}): void {
  input.options.metrics?.requests.inc({ ...input.labels, outcome: "error" });
  logLlmCallFailure({
    logger: input.options.logger,
    service: input.options.service,
    workload: input.options.workload,
    provider: input.provider,
    model: input.modelId,
    traceId: input.options.traceId,
    durationMs: input.durationMs,
    error: input.error,
  });
}

export type RuntimeMetricsHandle = RuntimeMetrics;
