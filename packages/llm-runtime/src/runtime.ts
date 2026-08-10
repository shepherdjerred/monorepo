import { context, propagation, trace } from "@opentelemetry/api";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getModel, requireOpenRouterRoute } from "@shepherdjerred/llm-models";
import { RepositoryOpenTelemetry } from "@shepherdjerred/llm-observability/ai-sdk-telemetry";
import {
  attributionHeaders,
  createAttributedFetch,
  type AttributedResponseObservation,
} from "./attributed-fetch.ts";
import {
  OpenRouterMetricsTelemetry,
  recordRouterResponse,
  runtimeMetrics,
} from "./metrics.ts";
import {
  defaultOpenRouterRuntimeLogger,
  logOpenRouterResponse,
} from "./logging.ts";
import type {
  CallOptionsInput,
  ModelRequirements,
  OpenRouterRuntimeOptions,
  RequiredModelCapability,
} from "./types.ts";

function requireCapability(
  modelId: string,
  capability: RequiredModelCapability,
): void {
  const model = getModel(modelId);
  if (model === undefined) throw new Error(`Unknown model id: ${modelId}`);
  if (!model.capabilities[capability]) {
    throw new Error(`Model ${modelId} does not support ${capability}`);
  }
}

function traceFields(input: CallOptionsInput): Record<string, string> {
  const activeSpanContext = trace.getSpan(context.active())?.spanContext();
  const traceId = input.traceContext?.traceId ?? activeSpanContext?.traceId;
  const parentSpanId =
    input.traceContext?.parentSpanId ?? activeSpanContext?.spanId;
  const fields: Record<string, string> = {
    generation_name: input.workload,
  };
  if (traceId !== undefined) fields["trace_id"] = traceId;
  if (parentSpanId !== undefined) fields["parent_span_id"] = parentSpanId;
  if (input.traceContext?.traceName !== undefined) {
    fields["trace_name"] = input.traceContext.traceName;
  }
  return fields;
}

function modelSettings(requirements: ModelRequirements) {
  return {
    usage: { include: true },
    structuredOutputs: { strict: true },
    provider: {
      allow_fallbacks: true,
      data_collection: "deny" as const,
      require_parameters:
        requirements.capabilities?.some(
          (capability) =>
            capability === "tools" || capability === "structuredOutputs",
        ) ?? false,
    },
  };
}

function resolveModel(modelId: string, requirements: ModelRequirements) {
  const route = requireOpenRouterRoute(modelId, requirements.endpoint);
  for (const capability of requirements.capabilities ?? []) {
    requireCapability(modelId, capability);
  }
  return route;
}

async function recordObservedResponse(input: {
  metrics: ReturnType<typeof runtimeMetrics> | undefined;
  observation: Promise<AttributedResponseObservation>;
  service: string;
  logger: NonNullable<OpenRouterRuntimeOptions["logger"]>;
}): Promise<void> {
  const observation = await input.observation;
  recordRouterResponse(input.metrics, {
    service: input.service,
    ...observation,
  });
  logOpenRouterResponse({
    logger: input.logger,
    observation,
    service: input.service,
  });
}

export function createOpenRouterRuntime(options: OpenRouterRuntimeOptions) {
  if (options.apiKey.trim() === "") {
    throw new Error("OpenRouter API key must not be empty");
  }
  const metrics = runtimeMetrics(options.metricsRegister);
  const logger = options.logger ?? defaultOpenRouterRuntimeLogger;
  const responseObservations = new Map<
    string,
    Promise<AttributedResponseObservation>
  >();
  const provider = createOpenRouter({
    apiKey: options.apiKey,
    appName: options.appName,
    compatibility: "strict",
    headers: { "X-OpenRouter-Metadata": "enabled" },
    fetch: createAttributedFetch(options.fetch ?? fetch, (input) => {
      if (input.observationId !== undefined) {
        responseObservations.set(input.observationId, input.observation);
      }
      void recordObservedResponse({
        metrics,
        observation: input.observation,
        service: options.service,
        logger,
      });
    }),
  });
  const openTelemetry = new RepositoryOpenTelemetry({
    service: options.service,
    usage: true,
    providerMetadata: true,
    schema: true,
    enrichSpan: () => ({
      "llm.service": options.service,
      "gen_ai.system": "openrouter",
    }),
  });

  return {
    languageModel(
      modelId: string,
      capabilities: readonly RequiredModelCapability[] = [],
    ) {
      const requirements = { endpoint: "language", capabilities } as const;
      const route = resolveModel(modelId, requirements);
      return provider.chat(route.modelId, modelSettings(requirements));
    },
    embeddingModel(modelId: string) {
      const requirements = { endpoint: "embedding" } as const;
      const route = resolveModel(modelId, requirements);
      return provider.textEmbeddingModel(
        route.modelId,
        modelSettings(requirements),
      );
    },
    imageModel(modelId: string) {
      const requirements = { endpoint: "image" } as const;
      const route = resolveModel(modelId, requirements);
      return provider.imageModel(route.modelId, modelSettings(requirements));
    },
    tools: provider.tools,
    callOptions(input: CallOptionsInput) {
      const carrier: Record<string, string> = {};
      propagation.inject(context.active(), carrier);
      const routerTrace = traceFields(input);
      const headers: Record<string, string> = {
        ...carrier,
        ...attributionHeaders({
          workload: input.workload,
          sessionId: input.sessionId,
          traceId: routerTrace["trace_id"],
          parentSpanId: routerTrace["parent_span_id"],
          traceName: routerTrace["trace_name"],
          observationId: input.observationId,
        }),
        ...(input.sessionId === undefined
          ? {}
          : { "x-session-id": input.sessionId }),
      };
      return {
        headers,
        include: { requestBody: true, responseBody: true },
        telemetry: {
          isEnabled: true,
          recordInputs: true,
          recordOutputs: true,
          functionId: input.workload,
          integrations: [
            openTelemetry,
            new OpenRouterMetricsTelemetry({
              metrics,
              service: options.service,
              workload: input.workload,
              logger,
              traceId: routerTrace["trace_id"],
            }),
          ],
        },
      };
    },
    async responseObservation(observationId: string) {
      const observation = responseObservations.get(observationId);
      if (observation === undefined) return;
      try {
        return await observation;
      } finally {
        responseObservations.delete(observationId);
      }
    },
    service: options.service,
    metrics,
  };
}

export type OpenRouterRuntime = ReturnType<typeof createOpenRouterRuntime>;
