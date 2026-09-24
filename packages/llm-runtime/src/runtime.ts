import { context, propagation, trace } from "@opentelemetry/api";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  getModel,
  requireNativeRoute,
  type NativeRoute,
  type Provider,
} from "@shepherdjerred/llm-models";
import { RepositoryOpenTelemetry } from "@shepherdjerred/llm-observability/ai-sdk-telemetry";
import { createFederatedAnthropicFetch } from "./anthropic-federation.ts";
import { LlmMetricsTelemetry, runtimeMetrics } from "./metrics.ts";
import { defaultLlmRuntimeLogger } from "./logging.ts";
import type {
  CallOptionsInput,
  LlmRuntimeOptions,
  ModelRequirements,
  RequiredModelCapability,
  RuntimeFetch,
} from "./types.ts";

/**
 * `@ai-sdk/anthropic` refuses to construct without some credential, and it
 * falls back to `ANTHROPIC_API_KEY` when none is passed. Under federation the
 * real credential is attached per-request by the fetch wrapper, so we hand the
 * provider an obviously-inert token instead of letting it reach for the
 * environment. If this string ever appears in an Authorization header, the
 * fetch wrapper did not run.
 */
const FEDERATION_PLACEHOLDER_TOKEN = "federation-token-attached-per-request";

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
  const fields: Record<string, string> = { generation_name: input.workload };
  if (traceId !== undefined) fields["trace_id"] = traceId;
  if (parentSpanId !== undefined) fields["parent_span_id"] = parentSpanId;
  if (input.traceContext?.traceName !== undefined) {
    fields["trace_name"] = input.traceContext.traceName;
  }
  return fields;
}

function resolveRoute(
  modelId: string,
  requirements: ModelRequirements,
): NativeRoute {
  const route = requireNativeRoute(modelId, requirements.endpoint);
  for (const capability of requirements.capabilities ?? []) {
    requireCapability(modelId, capability);
  }
  return route;
}

type ProviderClients = {
  openai: ReturnType<typeof createOpenAI>;
  anthropic: ReturnType<typeof createAnthropic>;
  google: ReturnType<typeof createGoogleGenerativeAI>;
};

/**
 * A provider and its client as a discriminated pair, so a caller that switches
 * on `provider` gets the right client type in each arm. A bare
 * `{ provider: Provider; client: ProviderClients[Provider] }` would widen the
 * client to the union and hide every provider-specific tool.
 */
type ProviderHandle = {
  [P in Provider]: { provider: P; client: ProviderClients[P] };
}[Provider];

/**
 * The AI SDK types its `fetch` hook as the full `typeof fetch`, which in Bun
 * carries `preconnect`. Our public `RuntimeFetch` is deliberately the smaller
 * request/response shape so tests and callers can pass a plain function, so it
 * gets adapted here rather than widening the public type.
 */
function asFetchFunction(runtimeFetch: RuntimeFetch): typeof fetch {
  const adapted: typeof fetch = async (input, init) =>
    runtimeFetch(input, init);
  adapted.preconnect = globalThis.fetch.preconnect;
  return adapted;
}

/**
 * Build providers lazily and once.
 *
 * Lazily, because a service that only ever calls OpenAI should not have to
 * hold Anthropic or Google configuration — it only fails if it actually asks
 * for a model routed there. Once, because the Anthropic wrapper caches a
 * federated token and rebuilding it per call would re-exchange a single-use
 * JWT on every request.
 */
function createProviderClients(options: LlmRuntimeOptions): {
  get: <P extends Provider>(provider: P) => ProviderClients[P];
} {
  const baseFetch: RuntimeFetch | undefined = options.fetch;
  const cache: { [P in Provider]?: ProviderClients[P] } = {};

  const builders: {
    [P in Provider]: () => ProviderClients[P];
  } = {
    openai: () => {
      const credentials = options.credentials.openai;
      if (credentials === undefined) {
        throw new Error(
          `${options.service}: model routes to OpenAI but no OpenAI credentials were configured`,
        );
      }
      return createOpenAI({
        apiKey: credentials.apiKey,
        ...(baseFetch !== undefined && { fetch: asFetchFunction(baseFetch) }),
      });
    },
    anthropic: () => {
      const credentials = options.credentials.anthropic;
      if (credentials === undefined) {
        throw new Error(
          `${options.service}: model routes to Anthropic but no Anthropic credentials were configured`,
        );
      }
      if (credentials.kind === "apiKey") {
        return createAnthropic({
          apiKey: credentials.apiKey,
          ...(baseFetch !== undefined && { fetch: asFetchFunction(baseFetch) }),
        });
      }
      return createAnthropic({
        authToken: FEDERATION_PLACEHOLDER_TOKEN,
        fetch: asFetchFunction(
          createFederatedAnthropicFetch(credentials, {
            fetch: baseFetch ?? fetch,
          }),
        ),
      });
    },
    google: () => {
      const credentials = options.credentials.google;
      if (credentials === undefined) {
        throw new Error(
          `${options.service}: model routes to Google but no Google credentials were configured`,
        );
      }
      return createGoogleGenerativeAI({
        apiKey: credentials.apiKey,
        ...(baseFetch !== undefined && { fetch: asFetchFunction(baseFetch) }),
      });
    },
  };

  return {
    get<P extends Provider>(provider: P): ProviderClients[P] {
      const existing = cache[provider];
      if (existing !== undefined) return existing;
      const built = builders[provider]();
      cache[provider] = built;
      return built;
    },
  };
}

/**
 * Refuse to run federated and keyed at the same time.
 *
 * The Anthropic SDKs rank `ANTHROPIC_API_KEY` above every federation tier, so a
 * leftover key silently wins and a deployment that believes it migrated is
 * still authenticating with a static secret. Our own fetch wrapper does not
 * consult the environment, but a key sitting in the pod is still evidence the
 * migration is half-done — and the Codex and Claude agent paths in this repo
 * DO read it. Fail loudly at construction rather than let it rot.
 */
function assertNoShadowingAnthropicKey(options: LlmRuntimeOptions): void {
  if (options.credentials.anthropic?.kind !== "federation") return;
  const shadow = Bun.env["ANTHROPIC_API_KEY"];
  if (shadow !== undefined && shadow.trim() !== "") {
    throw new Error(
      `${options.service}: ANTHROPIC_API_KEY is set while Anthropic credentials are federated. ` +
        `Unset it everywhere this workload runs — a static key shadows federation in the Anthropic SDKs.`,
    );
  }
}

/**
 * Ask the provider to enforce the JSON schemas we send.
 *
 * The gateway took one `structuredOutputs.strict` flag for every model. OpenAI
 * wants `strictJsonSchema` in its own provider options, and Anthropic and
 * Google validate tool arguments against the schema without a flag. Without
 * this, OpenAI silently accepts a tool call whose arguments do not match the
 * schema, which turns a provider-side rejection into a runtime parse failure
 * further downstream.
 */
/**
 * OpenAI-only call options. The AI SDK hands `providerOptions.openai` to the
 * OpenAI provider alone, so a prompt cache key is inert on other providers.
 *
 * `strictJsonSchema` needs the model to be known OpenAI; `promptCacheKey` is
 * OpenAI's own cache partition, which the Responses API otherwise derives per
 * request, so calls sharing a long prefix across sessions would never reuse it.
 */
function callProviderOptions(input: CallOptionsInput): {
  providerOptions?: {
    openai: { strictJsonSchema?: true; promptCacheKey?: string };
  };
} {
  const strict =
    input.model !== undefined &&
    requireNativeRoute(input.model).provider === "openai";
  const openai = {
    ...(strict ? { strictJsonSchema: true as const } : {}),
    ...(input.promptCacheKey === undefined
      ? {}
      : { promptCacheKey: input.promptCacheKey }),
  };
  return Object.keys(openai).length === 0
    ? {}
    : { providerOptions: { openai } };
}

export function createLlmRuntime(options: LlmRuntimeOptions) {
  assertNoShadowingAnthropicKey(options);

  const metrics = runtimeMetrics(options.metricsRegister);
  const logger = options.logger ?? defaultLlmRuntimeLogger;
  const providers = createProviderClients(options);

  const openTelemetry = new RepositoryOpenTelemetry({
    service: options.service,
    usage: true,
    providerMetadata: true,
    schema: true,
    enrichSpan: () => ({ "llm.service": options.service }),
  });

  return {
    languageModel(
      modelId: string,
      capabilities: readonly RequiredModelCapability[] = [],
    ) {
      const route = resolveRoute(modelId, {
        endpoint: "language",
        capabilities,
      });
      return providers.get(route.provider).languageModel(route.modelId);
    },
    embeddingModel(modelId: string) {
      const route = resolveRoute(modelId, { endpoint: "embedding" });
      if (route.provider !== "openai") {
        throw new Error(
          `Model ${modelId} routes embeddings to ${route.provider}, which this runtime does not wire up`,
        );
      }
      return providers.get("openai").embeddingModel(route.modelId);
    },
    imageModel(modelId: string) {
      const route = resolveRoute(modelId, { endpoint: "image" });
      if (route.provider !== "google") {
        throw new Error(
          `Model ${modelId} routes images to ${route.provider}, which this runtime does not wire up`,
        );
      }
      return providers.get("google").imageModel(route.modelId);
    },
    /** The provider client behind a model, for provider-specific tools. */
    providerFor(modelId: string): ProviderHandle {
      const { provider } = requireNativeRoute(modelId);
      switch (provider) {
        case "openai": {
          return { provider, client: providers.get("openai") };
        }
        case "anthropic": {
          return { provider, client: providers.get("anthropic") };
        }
        case "google": {
          return { provider, client: providers.get("google") };
        }
      }
    },
    callOptions(input: CallOptionsInput) {
      const carrier: Record<string, string> = {};
      propagation.inject(context.active(), carrier);
      const routerTrace = traceFields(input);
      return {
        ...callProviderOptions(input),
        headers: carrier,
        include: { requestBody: true, responseBody: true },
        telemetry: {
          isEnabled: true,
          recordInputs: true,
          recordOutputs: true,
          functionId: input.workload,
          integrations: [
            openTelemetry,
            new LlmMetricsTelemetry({
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
    service: options.service,
    metrics,
  };
}

export type LlmRuntime = ReturnType<typeof createLlmRuntime>;
