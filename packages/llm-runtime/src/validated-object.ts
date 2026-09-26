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
import { requireNativeRoute } from "@shepherdjerred/llm-models";
import {
  mergeProviderOptions as mergeOptionBuckets,
  reasoningProviderOptions,
  type ProviderOptions,
} from "./provider-options.ts";
import {
  addTokenBreakdown,
  emptyTokenBreakdown,
  parseNativeUsage,
} from "./usage.ts";
import type { LlmRuntime } from "./runtime.ts";
import {
  MAX_CORRECTIVE_PROMPT_CHARS,
  MAX_SEMANTIC_ATTEMPTS,
  StructuredOutputExhaustionError,
  StructuredOutputTransportError,
  type AggregateLlmUsage,
  type GenerateValidatedObjectInput,
  type GenerateValidatedObjectResult,
  type LlmCallMetadata,
  type StructuredOutputAttempt,
} from "./types.ts";

const MAX_TRANSPORT_RETRIES = 2;
const MAX_ISSUES = 8;
const CORRECTIVE_PROMPT_PREAMBLE =
  "\n\nThe prior structured response failed schema validation. Correct only these bounded issues and return a complete object matching the schema: ";
// Keeps the appended correction within MAX_CORRECTIVE_PROMPT_CHARS, which is
// what budget-reserving callers size a retry's input against.
const MAX_ISSUE_SUMMARY_CHARS =
  MAX_CORRECTIVE_PROMPT_CHARS - CORRECTIVE_PROMPT_PREAMBLE.length;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function apiErrors(error: unknown): readonly APICallError[] {
  if (APICallError.isInstance(error)) return [error];
  return RetryError.isInstance(error)
    ? error.errors.filter((item) => APICallError.isInstance(item))
    : [];
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
  return error instanceof Error && error.cause !== undefined
    ? findZodError(error.cause)
    : undefined;
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
  return priorIssueSummary === undefined
    ? originalPrompt
    : `${originalPrompt}${CORRECTIVE_PROMPT_PREAMBLE}${priorIssueSummary}`;
}

function outputTokenLimit(input: {
  initial: number | undefined;
  retry: number | undefined;
  semanticAttempt: number;
  priorFinishReason: string | undefined;
}): number | undefined {
  if (input.initial === undefined) return undefined;
  return input.priorFinishReason === "length" &&
    input.semanticAttempt > 1 &&
    input.retry !== undefined
    ? input.retry
    : input.initial;
}

function aggregateUsage(
  attempts: readonly StructuredOutputAttempt[],
): AggregateLlmUsage {
  let tokens = emptyTokenBreakdown();
  let catalogCostUsd = 0;
  for (const attempt of attempts) {
    tokens = addTokenBreakdown(tokens, attempt.usage);
    catalogCostUsd += attempt.metadata?.catalogCostUsd ?? 0;
  }
  return { tokens, catalogCostUsd };
}

/**
 * Merge reasoning options into the runtime's call options without either set
 * clobbering the other's provider bucket.
 */
function mergeProviderOptions<T extends { providerOptions?: ProviderOptions }>(
  callOptions: T,
  reasoning: ProviderOptions | undefined,
): T {
  const merged = mergeOptionBuckets(callOptions.providerOptions, reasoning);
  return merged === undefined
    ? callOptions
    : { ...callOptions, providerOptions: merged };
}

/**
 * Reasoning options for whichever provider serves this model, or nothing when
 * the request cannot be expressed there. See `reasoningProviderOptions`.
 */
function providerOptionsFor(
  modelId: string,
  effort: GenerateValidatedObjectInput<z.ZodType>["reasoningEffort"],
): { providerOptions?: ProviderOptions } {
  if (effort === undefined) return {};
  const options = reasoningProviderOptions(
    requireNativeRoute(modelId, "language").provider,
    modelId,
    effort,
  );
  return options === undefined ? {} : { providerOptions: options };
}

async function generateStructuredAttempt<SCHEMA extends z.ZodType>(input: {
  runtime: LlmRuntime;
  request: GenerateValidatedObjectInput<SCHEMA>;
  semanticAttempt: number;
  priorIssueSummary: string | undefined;
  priorFinishReason: string | undefined;
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
    ...(input.request.abortSignal === undefined
      ? {}
      : { abortSignal: input.request.abortSignal }),
    maxRetries: input.semanticAttempt === 1 ? MAX_TRANSPORT_RETRIES : 0,
    ...mergeProviderOptions(
      input.runtime.callOptions({
        workload: input.request.workload,
        model: input.request.model,
        sessionId: input.request.sessionId,
        traceContext: input.request.traceContext,
      }),
      providerOptionsFor(input.request.model, input.request.reasoningEffort)
        .providerOptions,
    ),
  });
}

export async function generateValidatedObject<SCHEMA extends z.ZodType>(
  runtime: LlmRuntime,
  input: GenerateValidatedObjectInput<SCHEMA>,
): Promise<GenerateValidatedObjectResult<SCHEMA>> {
  const { provider } = requireNativeRoute(input.model, "language");
  const attempts: StructuredOutputAttempt[] = [];
  const metadata: LlmCallMetadata[] = [];
  let priorIssueSummary: string | undefined;
  let priorFinishReason: string | undefined;

  return withLlmSpan(
    {
      service: runtime.service,
      callSite: input.workload,
      system: provider,
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
          });
          const callMetadata = parseNativeUsage({
            requestedModel: input.model,
            provider,
            responseId: result.finalStep.response.id,
            resolvedModel: result.finalStep.response.modelId,
            usage: result.usage,
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
          if (isImmediateFailure(error)) {
            // A 400–404 on a corrective attempt (e.g. a 402 after the first
            // billable call drained the balance) still follows billable
            // attempts; discarding their usage would let budget-metering
            // callers undercount exactly when the account is under pressure.
            if (attempts.some((prior) => prior.outcome === "semantic-error")) {
              throw new StructuredOutputTransportError(
                `Provider call failed on semantic attempt ${String(semanticAttempt)} for ${input.workload} after earlier billable attempts`,
                attempts,
                aggregateUsage(attempts),
                { cause: error },
              );
            }
            throw error;
          }
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
            // A transport failure after a billable semantic attempt must not
            // discard the tokens those attempts already spent: budget-metering
            // callers only see usage on the thrown error.
            if (attempts.some((prior) => prior.outcome === "semantic-error")) {
              throw new StructuredOutputTransportError(
                `Transport failure on semantic attempt ${String(semanticAttempt)} for ${input.workload} after earlier billable attempts`,
                attempts,
                aggregateUsage(attempts),
                { cause: error },
              );
            }
            throw error;
          }
          if (!NoObjectGeneratedError.isInstance(error)) throw error;

          const callMetadata = parseNativeUsage({
            requestedModel: input.model,
            provider,
            responseId: error.response?.id,
            resolvedModel: error.response?.modelId,
            usage: error.usage,
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
