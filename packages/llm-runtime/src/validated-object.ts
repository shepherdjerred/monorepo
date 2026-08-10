import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  RetryError,
} from "ai";
import {
  withLlmSpan,
  serializeBodyAttribute,
} from "@shepherdjerred/llm-observability/span-helpers";
import { z } from "zod";
import {
  addTokenBreakdown,
  emptyTokenBreakdown,
  parseOpenRouterMetadata,
} from "./metadata.ts";
import type { OpenRouterRuntime } from "./runtime.ts";
import {
  StructuredOutputExhaustionError,
  type AggregateOpenRouterUsage,
  type GenerateValidatedObjectInput,
  type GenerateValidatedObjectResult,
  type OpenRouterCallMetadata,
  type StructuredOutputAttempt,
} from "./types.ts";

const MAX_SEMANTIC_ATTEMPTS = 3;
const MAX_TRANSPORT_RETRIES = 2;
const MAX_ISSUES = 8;
const MAX_ISSUE_SUMMARY_CHARS = 1200;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function apiErrors(error: unknown): readonly APICallError[] {
  if (APICallError.isInstance(error)) return [error];
  if (RetryError.isInstance(error)) {
    return error.errors.filter((item) => APICallError.isInstance(item));
  }
  return [];
}

function isImmediateFailure(error: unknown): boolean {
  return apiErrors(error).some((apiError) => {
    const status = apiError.statusCode;
    return (
      status === 400 ||
      status === 401 ||
      status === 402 ||
      status === 403 ||
      status === 404
    );
  });
}

function isTransportFailure(error: unknown): boolean {
  const errors = apiErrors(error);
  if (errors.length === 0) return false;
  return errors.every((apiError) => {
    const status = apiError.statusCode;
    return status === undefined || status === 429 || status >= 500;
  });
}

function findZodError(error: unknown): z.ZodError | undefined {
  if (error instanceof z.ZodError) return error;
  if (error instanceof Error && error.cause !== undefined) {
    return findZodError(error.cause);
  }
  return undefined;
}

function issueSummary(error: unknown): string {
  const zodError = findZodError(error);
  if (zodError === undefined) {
    return errorMessage(error).slice(0, MAX_ISSUE_SUMMARY_CHARS);
  }
  return zodError.issues
    .slice(0, MAX_ISSUES)
    .map((issue) => {
      const path = issue.path.length === 0 ? "$" : `$.${issue.path.join(".")}`;
      return `${path}: ${issue.message}`;
    })
    .join("; ")
    .slice(0, MAX_ISSUE_SUMMARY_CHARS);
}

function requireObjectOutput<OBJECT>(
  read: () => OBJECT,
  context: ConstructorParameters<typeof NoObjectGeneratedError>[0],
): OBJECT {
  try {
    return read();
  } catch (error: unknown) {
    if (!NoOutputGeneratedError.isInstance(error)) throw error;
    throw new NoObjectGeneratedError({ ...context, cause: error });
  }
}

function correctivePrompt(
  originalPrompt: string,
  priorIssueSummary: string | undefined,
): string {
  if (priorIssueSummary === undefined) return originalPrompt;
  return `${originalPrompt}\n\nThe prior structured response failed schema validation. Correct only these bounded issues and return a complete object matching the schema: ${priorIssueSummary}`;
}

function outputTokenLimit(input: {
  initial: number | undefined;
  retry: number | undefined;
  semanticAttempt: number;
  priorFinishReason: string | undefined;
}): number | undefined {
  if (input.initial === undefined) return undefined;
  if (
    input.priorFinishReason === "length" &&
    input.semanticAttempt > 1 &&
    input.retry !== undefined
  ) {
    return input.retry;
  }
  return input.initial;
}

function aggregateUsage(
  attempts: readonly StructuredOutputAttempt[],
): AggregateOpenRouterUsage {
  let tokens = emptyTokenBreakdown();
  let actualCostUsd = 0;
  let catalogCostUsd = 0;
  let upstreamCostUsd = 0;
  for (const attempt of attempts) {
    tokens = addTokenBreakdown(tokens, attempt.usage);
    actualCostUsd += attempt.metadata?.actualCostUsd ?? 0;
    catalogCostUsd += attempt.metadata?.catalogCostUsd ?? 0;
    upstreamCostUsd += attempt.metadata?.upstreamCostUsd ?? 0;
  }
  return { tokens, actualCostUsd, catalogCostUsd, upstreamCostUsd };
}

async function generateStructuredAttempt<SCHEMA extends z.ZodType>(input: {
  runtime: OpenRouterRuntime;
  request: GenerateValidatedObjectInput<SCHEMA>;
  semanticAttempt: number;
  priorIssueSummary: string | undefined;
  priorFinishReason: string | undefined;
  observationId: string;
}) {
  const maxOutputTokens = outputTokenLimit({
    initial: input.request.maxOutputTokens,
    retry: input.request.semanticRetryMaxOutputTokens,
    semanticAttempt: input.semanticAttempt,
    priorFinishReason: input.priorFinishReason,
  });
  const output = Output.object<z.output<SCHEMA>>({
    schema: input.request.schema,
    name: input.request.schemaName,
    ...(input.request.schemaDescription === undefined
      ? {}
      : { description: input.request.schemaDescription }),
  });
  return generateText({
    model: input.runtime.languageModel(input.request.model, [
      "structuredOutputs",
    ]),
    ...(input.request.system === undefined
      ? {}
      : { system: input.request.system }),
    prompt: correctivePrompt(input.request.prompt, input.priorIssueSummary),
    output,
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(input.request.seed === undefined ? {} : { seed: input.request.seed }),
    ...(input.request.reasoningEffort === undefined
      ? {}
      : {
          providerOptions: {
            openrouter: {
              reasoning: { effort: input.request.reasoningEffort },
            },
          },
        }),
    ...(input.request.abortSignal === undefined
      ? {}
      : { abortSignal: input.request.abortSignal }),
    maxRetries: input.semanticAttempt === 1 ? MAX_TRANSPORT_RETRIES : 0,
    ...input.runtime.callOptions({
      workload: input.request.workload,
      sessionId: input.request.sessionId,
      traceContext: input.request.traceContext,
      observationId: input.observationId,
    }),
  });
}

export async function generateValidatedObject<SCHEMA extends z.ZodType>(
  runtime: OpenRouterRuntime,
  input: GenerateValidatedObjectInput<SCHEMA>,
): Promise<GenerateValidatedObjectResult<SCHEMA>> {
  const attempts: StructuredOutputAttempt[] = [];
  const metadata: OpenRouterCallMetadata[] = [];
  let priorIssueSummary: string | undefined;
  let priorFinishReason: string | undefined;

  return withLlmSpan(
    {
      service: runtime.service,
      callSite: input.workload,
      system: "openrouter",
    },
    {
      model: input.model,
      maxTokens: input.maxOutputTokens,
      temperature: undefined,
      topP: undefined,
      stopSequences: undefined,
    },
    async (span) => {
      span.setAttribute(
        "gen_ai.input.messages",
        serializeBodyAttribute({ system: input.system, prompt: input.prompt }),
      );

      for (
        let semanticAttempt = 1;
        semanticAttempt <= MAX_SEMANTIC_ATTEMPTS;
        semanticAttempt += 1
      ) {
        const observationId = crypto.randomUUID();
        span.addEvent("llm.structured_output.attempt", {
          "llm.structured_output.attempt": semanticAttempt,
        });
        try {
          const result = await generateStructuredAttempt({
            runtime,
            request: input,
            semanticAttempt,
            priorIssueSummary,
            priorFinishReason,
            observationId,
          });
          const observation = await runtime.responseObservation(observationId);
          const callMetadata = parseOpenRouterMetadata({
            requestedModel: input.model,
            responseId: result.finalStep.response.id,
            resolvedModel: result.finalStep.response.modelId,
            usage: result.usage,
            providerMetadata: result.finalStep.providerMetadata,
            responseBody:
              observation?.responseBody ?? result.finalStep.response.body,
          });
          const object = requireObjectOutput(() => result.output, {
            text: result.finalStep.text,
            response: result.finalStep.response,
            usage: result.usage,
            finishReason: result.finishReason,
          });
          metadata.push(callMetadata);
          const attempt: StructuredOutputAttempt = {
            attempt: semanticAttempt,
            outcome: "success",
            usage: callMetadata.tokens,
            metadata: callMetadata,
          };
          attempts.push(attempt);
          runtime.metrics?.structuredAttempts.inc({
            service: runtime.service,
            workload: input.workload,
            model: input.model,
            outcome: "success",
          });
          span.setAttribute(
            "gen_ai.output.messages",
            serializeBodyAttribute(object),
          );
          return {
            object,
            usage: aggregateUsage(attempts),
            metadata,
            attempts,
          };
        } catch (error: unknown) {
          const observation = await runtime.responseObservation(observationId);
          if (isImmediateFailure(error)) throw error;
          if (isTransportFailure(error)) {
            attempts.push({
              attempt: semanticAttempt,
              outcome: "transport-error",
              error: errorMessage(error),
              usage: emptyTokenBreakdown(),
            });
            runtime.metrics?.structuredAttempts.inc({
              service: runtime.service,
              workload: input.workload,
              model: input.model,
              outcome: "transport_error",
            });
            throw error;
          }
          if (!NoObjectGeneratedError.isInstance(error)) throw error;

          const callMetadata = parseOpenRouterMetadata({
            requestedModel: input.model,
            responseId: error.response?.id,
            resolvedModel: error.response?.modelId,
            usage: error.usage,
            responseBody: observation?.responseBody,
          });

          priorIssueSummary = issueSummary(error);
          priorFinishReason = error.finishReason;
          metadata.push(callMetadata);
          attempts.push({
            attempt: semanticAttempt,
            outcome: "semantic-error",
            issueSummary: priorIssueSummary,
            error: errorMessage(error),
            usage: callMetadata.tokens,
            metadata: callMetadata,
            finishReason: error.finishReason,
            generatedText: error.text,
          });
          runtime.metrics?.structuredAttempts.inc({
            service: runtime.service,
            workload: input.workload,
            model: input.model,
            outcome: "semantic_error",
          });
        }
      }

      runtime.metrics?.structuredAttempts.inc({
        service: runtime.service,
        workload: input.workload,
        model: input.model,
        outcome: "exhausted",
      });
      throw new StructuredOutputExhaustionError(
        `Structured output exhausted ${String(MAX_SEMANTIC_ATTEMPTS)} semantic attempts for ${input.workload}`,
        attempts,
        aggregateUsage(attempts),
      );
    },
  );
}
