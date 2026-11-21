import {
  context,
  isSpanContextValid,
  propagation,
  type Span,
} from "@opentelemetry/api";
import {
  costForDecisionUsage,
  requireNativeRoute,
} from "@shepherdjerred/llm-models";
import {
  activeLlmSubjectAttributes,
  redactSecrets,
  serializeBodyAttribute,
  setLlmResponseAttributes,
  withLlmSpan,
} from "@shepherdjerred/llm-observability";
import type { CommonLlmMetrics } from "@shepherdjerred/llm-observability/metrics";
import { z } from "zod";
import {
  DecisionRequestSchema,
  DecisionWireResponseSchema,
  DecisionWireUsageSchema,
  type DecisionAnswer,
  type DecisionAnswerSchema,
  type DecisionRequest,
  type DecisionResult,
  type DecisionResultUsage,
  type DecisionWireResponse,
  type DecisionWireUsage,
} from "./decision-schemas.ts";
import { logLlmCallFailure, logLlmResponse, stableModelId } from "./logging.ts";
import { recordTokenUsageMetrics } from "./metrics.ts";
import type {
  LlmCallMetadata,
  LlmRuntimeLogger,
  LlmRuntimeOptions,
  RuntimeFetch,
} from "./types.ts";

const DECISIONS_ENDPOINT = "https://api.openai.com/v1/decisions";
const MAX_ERROR_DETAIL_CHARS = 240;

export type DecisionErrorKind = "http" | "transport" | "parse" | "aborted";

export class DecisionApiError extends Error {
  readonly kind: DecisionErrorKind;
  readonly status?: number | undefined;
  readonly retryAfter?: string | undefined;
  readonly usage?: DecisionWireUsage | undefined;

  constructor(
    message: string,
    options: {
      readonly kind: DecisionErrorKind;
      readonly status?: number | undefined;
      readonly retryAfter?: string | undefined;
      readonly usage?: DecisionWireUsage | undefined;
      readonly cause?: unknown;
    },
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "DecisionApiError";
    this.kind = options.kind;
    this.status = options.status;
    this.retryAfter = options.retryAfter;
    this.usage = options.usage;
  }
}

const ProviderErrorBodySchema = z
  .object({
    error: z
      .object({
        message: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

function sanitizeErrorBody(rawBody: string, apiKey: string): string {
  let candidate = rawBody;
  try {
    const parsed = ProviderErrorBodySchema.safeParse(JSON.parse(rawBody));
    if (parsed.success && parsed.data.error?.message !== undefined) {
      candidate = parsed.data.error.message;
    }
  } catch {
    // Raw text body; sanitize directly below.
  }
  const redacted = redactSecrets(candidate, [apiKey]);
  const text = (typeof redacted === "string" ? redacted : String(redacted))
    .replaceAll(/\s+/g, " ")
    .trim();
  return text.length > MAX_ERROR_DETAIL_CHARS
    ? `${text.slice(0, MAX_ERROR_DETAIL_CHARS)}...`
    : text;
}

function buildWirePayload(
  routeModelId: string,
  input: DecisionRequest,
): Record<string, unknown> {
  return {
    model: routeModelId,
    ...(input.system === undefined ? {} : { system: input.system }),
    input: input.input,
    questions: input.questions,
    ...(input.promptCacheKey === undefined
      ? {}
      : { prompt_cache_key: input.promptCacheKey }),
    ...(input.promptCacheOptions === undefined
      ? {}
      : { prompt_cache_options: input.promptCacheOptions }),
    ...(input.safetyIdentifier === undefined
      ? {}
      : { safety_identifier: input.safetyIdentifier }),
  };
}

function spanTraceId(span: Span): string | undefined {
  const spanContext = span.spanContext();
  return isSpanContextValid(spanContext) ? spanContext.traceId : undefined;
}

function normalizeAnswer(
  answer: z.output<typeof DecisionAnswerSchema>,
): DecisionAnswer {
  switch (answer.type) {
    case "predicate": {
      return {
        type: "predicate",
        name: answer.name,
        probability: answer.probability,
      };
    }
    case "choice": {
      return {
        type: "choice",
        name: answer.name,
        choice: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities.map((entry) => ({
          value: entry.value,
          probability: entry.probability,
        })),
      };
    }
    case "score": {
      return {
        type: "score",
        name: answer.name,
        score: answer.score,
        confidence: answer.confidence,
        probabilities: answer.probabilities.map((entry) => ({
          label: entry.label,
          value: entry.value,
          probability: entry.probability,
        })),
      };
    }
    case "refusal": {
      return {
        type: "refusal",
        name: answer.name,
      };
    }
  }
}

async function sendDecisionRequest(input: {
  readonly fetcher: RuntimeFetch;
  readonly apiKey: string;
  readonly body: string;
  readonly abortSignal: AbortSignal | undefined;
}): Promise<
  DecisionWireResponse & { readonly requestIdHeader: string | undefined }
> {
  const headers: Record<string, string> = {};
  propagation.inject(context.active(), headers);
  headers["Authorization"] = `Bearer ${input.apiKey}`;
  headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await input.fetcher(DECISIONS_ENDPOINT, {
      method: "POST",
      headers,
      body: input.body,
      ...(input.abortSignal === undefined ? {} : { signal: input.abortSignal }),
    });
  } catch (error: unknown) {
    const aborted =
      input.abortSignal?.aborted === true ||
      (error instanceof Error && error.name === "AbortError");
    throw new DecisionApiError(
      aborted
        ? "OpenAI Decisions API request was aborted"
        : "OpenAI Decisions API transport failed",
      {
        kind: aborted ? "aborted" : "transport",
        cause: error,
      },
    );
  }

  if (!response.ok) {
    let rawText: string;
    try {
      rawText = await response.text();
    } catch {
      rawText = "";
    }
    const detail = sanitizeErrorBody(rawText, input.apiKey);
    const suffix = detail === "" ? "" : `: ${detail}`;
    throw new DecisionApiError(
      `OpenAI Decisions API returned HTTP ${String(response.status)}${suffix}`,
      {
        kind: "http",
        status: response.status,
        retryAfter: response.headers.get("retry-after") ?? undefined,
      },
    );
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (error: unknown) {
    throw new DecisionApiError("OpenAI Decisions API returned invalid JSON", {
      kind: "parse",
      cause: error,
    });
  }

  const parsed = DecisionWireResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    const usage = z
      .object({ usage: DecisionWireUsageSchema })
      .safeParse(rawJson).data?.usage;
    throw new DecisionApiError(
      "OpenAI Decisions API returned an invalid response payload",
      {
        kind: "parse",
        cause: parsed.error,
        usage,
      },
    );
  }

  return {
    ...parsed.data,
    requestIdHeader: response.headers.get("x-request-id") ?? undefined,
  };
}

function recordDecisionSuccess(input: {
  readonly metrics: CommonLlmMetrics | undefined;
  readonly logger: LlmRuntimeLogger;
  readonly service: string;
  readonly workload: string;
  readonly requestedModel: string;
  readonly parsed: DecisionWireResponse;
  readonly responseId: string | undefined;
  readonly usage: DecisionResultUsage;
  readonly catalogCostUsd: number | undefined;
  readonly traceId: string | undefined;
  readonly durationMs: number;
}): void {
  const uncachedInput = Math.max(
    0,
    input.usage.inputTokens -
      input.usage.cachedInputTokens -
      input.usage.cacheWriteTokens,
  );
  const metadata: LlmCallMetadata = {
    requestedModel: input.requestedModel,
    resolvedModel: stableModelId("openai", input.parsed.model),
    provider: "openai",
    ...(input.responseId === undefined ? {} : { responseId: input.responseId }),
    tokens: {
      input: uncachedInput,
      output: input.usage.outputTokens,
      cachedInput: input.usage.cachedInputTokens,
      cacheWrite: input.usage.cacheWriteTokens,
      reasoning: input.usage.reasoningTokens,
      total: input.usage.totalTokens,
    },
    ...(input.catalogCostUsd === undefined
      ? {}
      : { catalogCostUsd: input.catalogCostUsd }),
  };

  recordTokenUsageMetrics({
    metrics: input.metrics,
    service: input.service,
    workload: input.workload,
    provider: "openai",
    metadata,
    durationMs: input.durationMs,
  });

  logLlmResponse({
    logger: input.logger,
    service: input.service,
    workload: input.workload,
    metadata,
    traceId: input.traceId,
    durationMs: input.durationMs,
  });
}

export type DecisionRuntimeContext = {
  readonly options: LlmRuntimeOptions;
  readonly metrics: CommonLlmMetrics | undefined;
  readonly logger: LlmRuntimeLogger;
};

export async function executeDecision(
  runtimeContext: DecisionRuntimeContext,
  rawInput: DecisionRequest,
): Promise<DecisionResult> {
  const input = DecisionRequestSchema.parse(rawInput);
  const requestedModel = input.model;
  const route = requireNativeRoute(requestedModel, "decisions");
  if (route.provider !== "openai") {
    throw new Error(
      `Model ${requestedModel} routes decisions to ${route.provider}, which this runtime does not wire up`,
    );
  }
  const apiKey = runtimeContext.options.credentials.openai?.apiKey;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error(
      `${runtimeContext.options.service}: model routes to OpenAI but no OpenAI credentials were configured`,
    );
  }

  const fetcher: RuntimeFetch = runtimeContext.options.fetch ?? fetch;
  const body = JSON.stringify(buildWirePayload(route.modelId, input));

  return withLlmSpan(
    {
      service: runtimeContext.options.service,
      callSite: input.workload,
      system: "openai",
    },
    {
      model: requestedModel,
      maxTokens: undefined,
      temperature: undefined,
      topP: undefined,
      stopSequences: undefined,
    },
    async (span) => {
      const startedAt = performance.now();
      const traceId = spanTraceId(span);
      span.setAttributes({
        ...activeLlmSubjectAttributes(),
        "gen_ai.provider.name": "openai",
        ...(input.system === undefined
          ? {}
          : {
              "gen_ai.system_instructions": serializeBodyAttribute(
                input.system,
              ),
            }),
        "gen_ai.input.messages": serializeBodyAttribute({
          input: input.input,
          questions: input.questions,
        }),
      });

      let wireResponse: Awaited<ReturnType<typeof sendDecisionRequest>>;
      try {
        wireResponse = await sendDecisionRequest({
          fetcher,
          apiKey,
          body,
          abortSignal: input.abortSignal,
        });
      } catch (error: unknown) {
        const durationMs = performance.now() - startedAt;
        runtimeContext.metrics?.requests.inc({
          service: runtimeContext.options.service,
          workload: input.workload,
          provider: "openai",
          model: requestedModel,
          outcome: "error",
        });
        logLlmCallFailure({
          logger: runtimeContext.logger,
          service: runtimeContext.options.service,
          workload: input.workload,
          provider: "openai",
          model: requestedModel,
          traceId,
          durationMs,
          error,
        });
        throw error;
      }

      const durationMs = performance.now() - startedAt;
      const inputTokens = wireResponse.usage.input_tokens;
      const cachedInputTokens =
        wireResponse.usage.input_tokens_details?.cached_tokens ?? 0;
      const cacheWriteTokens =
        wireResponse.usage.input_tokens_details?.cache_write_tokens ?? 0;
      const outputTokens = wireResponse.usage.output_tokens;
      const reasoningTokens =
        wireResponse.usage.output_tokens_details?.reasoning_tokens ?? 0;
      const totalTokens = wireResponse.usage.total_tokens;
      const responseId = wireResponse.requestIdHeader ?? wireResponse.id;
      const answers = wireResponse.answers.map((answer) =>
        normalizeAnswer(answer),
      );

      span.setAttributes({
        "gen_ai.output.messages": serializeBodyAttribute(answers),
      });
      setLlmResponseAttributes(span, {
        model: wireResponse.model,
        id: responseId,
        finishReasons: undefined,
        inputTokens,
        outputTokens,
        cacheReadInputTokens: cachedInputTokens,
        cacheCreationInputTokens: cacheWriteTokens,
      });

      const usage: DecisionResultUsage = {
        inputTokens,
        cachedInputTokens,
        cacheWriteTokens,
        outputTokens,
        reasoningTokens,
        totalTokens,
      };
      const catalogCostUsd = costForDecisionUsage(requestedModel, {
        inputTokens,
        cachedInputTokens,
        cacheWriteTokens,
      });

      recordDecisionSuccess({
        metrics: runtimeContext.metrics,
        logger: runtimeContext.logger,
        service: runtimeContext.options.service,
        workload: input.workload,
        requestedModel,
        parsed: wireResponse,
        responseId,
        usage,
        catalogCostUsd,
        traceId,
        durationMs,
      });

      return {
        model: wireResponse.model,
        answers,
        answerByName: (name: string) =>
          answers.find((answer) => answer.name === name),
        usage,
        catalogCostUsd,
      };
    },
  );
}
