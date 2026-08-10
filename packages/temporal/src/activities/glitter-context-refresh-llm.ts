import { z } from "zod/v4";
import { costForTextUsage } from "@shepherdjerred/llm-models";
import {
  generateValidatedObject,
  StructuredOutputExhaustionError,
} from "@shepherdjerred/llm-runtime";
import { ApplicationFailure } from "@temporalio/common";
import type { GenerationBudget } from "./glitter-context-refresh-budget.ts";
import {
  GenerationUsageSchema,
  type GenerationArtifactResult,
  type GenerationUsage,
} from "./glitter-context-refresh-cache.ts";
import { temporalOpenRouterRuntime } from "./openrouter-runtime.ts";

export function glitterPrompt(system: string, user: string) {
  return { system, prompt: user };
}

export function glitterObjectArtifactSchema<Response>(
  responseSchema: z.ZodType<Response>,
) {
  return z.discriminatedUnion("outcome", [
    z.strictObject({
      outcome: z.literal("success"),
      value: responseSchema,
    }),
    z.strictObject({
      outcome: z.literal("failure"),
      error: z.string().min(1),
      rawContent: z.string().nullable(),
    }),
  ]);
}

export type GlitterObjectArtifact<Response> =
  | { outcome: "success"; value: Response }
  | {
      outcome: "failure";
      error: string;
      rawContent: string | null;
    };

export function glitterObjectArtifact<Response>(input: {
  model: string;
  parsed: Response | null | undefined;
  rawContent: string | null;
  usage: GenerationUsage | undefined;
  failureError?: string | undefined;
  missingParsedError: string;
}): {
  response: GlitterObjectArtifact<Response>;
  usage: GenerationUsage;
} {
  if (input.usage === undefined) {
    throw ApplicationFailure.nonRetryable(
      `OpenRouter returned a billable completion without valid usage for ${input.model}; automatic retry is disabled because the completed request may already have been charged`,
      "BilledGenerationUsageUnavailable",
      { model: input.model },
    );
  }
  return {
    response:
      input.parsed === null || input.parsed === undefined
        ? {
            outcome: "failure",
            error: input.failureError ?? input.missingParsedError,
            rawContent: input.rawContent,
          }
        : { outcome: "success", value: input.parsed },
    usage: input.usage,
  };
}

function catalogCostUsd(
  model: string,
  usage: {
    input: number;
    output: number;
    cachedInput: number;
  },
): number {
  const cost = costForTextUsage(model, {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cachedInputTokens: usage.cachedInput,
  });
  if (cost === undefined) {
    throw new Error(`missing text pricing for ${model}`);
  }
  return cost;
}

function generationUsage(input: {
  model: string;
  tokens: {
    input: number;
    output: number;
    cachedInput: number;
  };
  actualCostUsd: number;
}): GenerationUsage {
  return GenerationUsageSchema.parse({
    inputTokens: input.tokens.input,
    outputTokens: input.tokens.output,
    cachedInputTokens: input.tokens.cachedInput,
    costUsd:
      input.actualCostUsd > 0
        ? input.actualCostUsd
        : catalogCostUsd(input.model, input.tokens),
  });
}

export async function generateGlitterObject<SCHEMA extends z.ZodType>(input: {
  model: string;
  schema: SCHEMA;
  schemaName: string;
  system: string;
  prompt: string;
  workload: string;
  maxOutputTokens: number;
  semanticRetryMaxOutputTokens?: number | undefined;
  reasoningEffort: "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
  seed: number;
  exhaustionError: string;
  truncationError?: string | undefined;
}): Promise<{
  response: GlitterObjectArtifact<z.output<SCHEMA>>;
  usage: GenerationUsage;
}> {
  try {
    const result = await generateValidatedObject(temporalOpenRouterRuntime(), {
      model: input.model,
      schema: input.schema,
      schemaName: input.schemaName,
      system: input.system,
      prompt: input.prompt,
      workload: input.workload,
      maxOutputTokens: input.maxOutputTokens,
      semanticRetryMaxOutputTokens: input.semanticRetryMaxOutputTokens,
      reasoningEffort: input.reasoningEffort,
      seed: input.seed,
    });
    return glitterObjectArtifact<z.output<SCHEMA>>({
      model: input.model,
      parsed: result.object,
      rawContent: null,
      usage: generationUsage({
        model: input.model,
        tokens: result.usage.tokens,
        actualCostUsd: result.usage.actualCostUsd,
      }),
      missingParsedError: input.exhaustionError,
    });
  } catch (error: unknown) {
    if (!(error instanceof StructuredOutputExhaustionError)) throw error;
    const lastAttempt = error.attempts.at(-1);
    const exhaustedByLength = error.attempts.some(
      (attempt) => attempt.finishReason === "length",
    );
    return glitterObjectArtifact<z.output<SCHEMA>>({
      model: input.model,
      parsed: undefined,
      rawContent: lastAttempt?.generatedText ?? null,
      usage: generationUsage({
        model: input.model,
        tokens: error.usage.tokens,
        actualCostUsd: error.usage.actualCostUsd,
      }),
      ...(exhaustedByLength && input.truncationError !== undefined
        ? { failureError: input.truncationError }
        : {}),
      missingParsedError: input.exhaustionError,
    });
  }
}

export function useGlitterObjectArtifact<Response>(input: {
  artifact: GenerationArtifactResult<GlitterObjectArtifact<Response>>;
  budget: GenerationBudget;
}): Response {
  input.budget.record(input.artifact);
  if (input.artifact.response.outcome === "failure") {
    throw new Error(input.artifact.response.error);
  }
  return input.artifact.response.value;
}
