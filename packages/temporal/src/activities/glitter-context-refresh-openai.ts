import OpenAI from "openai";
import { z } from "zod/v4";
import {
  traceOpenAi,
  type TraceOpenAiMetadata,
} from "@shepherdjerred/llm-observability";
import { ApplicationFailure } from "@temporalio/common";
import {
  type GenerationBudget,
  openAiGenerationUsage,
} from "./glitter-context-refresh-budget.ts";
import {
  GenerationUsageSchema,
  type GenerationArtifactResult,
  type GenerationUsage,
} from "./glitter-context-refresh-cache.ts";

const OpenAiCompletionUsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  prompt_tokens_details: z
    .object({
      cached_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

function requireOpenAiApiKey(): string {
  const value = Bun.env["OPENAI_API_KEY"];
  if (value === undefined || value === "") {
    throw new Error("OPENAI_API_KEY is required for Glitter context refresh");
  }
  return value;
}

function client(): OpenAI {
  return new OpenAI({ apiKey: requireOpenAiApiKey() });
}

export function glitterChatMessages(system: string, user: string) {
  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

export async function parseGlitterCompletion<
  Params extends OpenAI.Chat.ChatCompletionCreateParamsNonStreaming &
    TraceOpenAiMetadata["request"],
>(callSite: string, params: Params) {
  return await traceOpenAi(
    {
      service: "temporal",
      callSite,
      request: params,
    },
    async () => client().chat.completions.parse(params),
  );
}

export function glitterCompletionUsage(input: {
  model: string;
  usage: OpenAI.Completions.CompletionUsage | undefined;
}): GenerationUsage {
  const parsedUsage = OpenAiCompletionUsageSchema.safeParse(input.usage);
  if (!parsedUsage.success) {
    throw ApplicationFailure.nonRetryable(
      `OpenAI returned a billable completion without valid usage for ${input.model}; automatic retry is disabled because the completed request may already have been charged`,
      "BilledGenerationUsageUnavailable",
      {
        model: input.model,
        validationError: z.treeifyError(parsedUsage.error),
      },
    );
  }
  try {
    return GenerationUsageSchema.parse(
      openAiGenerationUsage({
        model: input.model,
        promptTokens: parsedUsage.data.prompt_tokens,
        completionTokens: parsedUsage.data.completion_tokens,
        cachedPromptTokens:
          parsedUsage.data.prompt_tokens_details?.cached_tokens ?? 0,
      }),
    );
  } catch (error: unknown) {
    const reason =
      error instanceof Error ? error.message : "unknown usage conversion error";
    throw ApplicationFailure.nonRetryable(
      `OpenAI returned a billable completion whose usage could not be accounted for ${input.model}: ${reason}; automatic retry is disabled`,
      "BilledGenerationUsageUnavailable",
      {
        model: input.model,
        reason,
      },
    );
  }
}

export function glitterCompletionArtifactSchema<Response>(
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

export type GlitterCompletionArtifact<Response> =
  | {
      outcome: "success";
      value: Response;
    }
  | {
      outcome: "failure";
      error: string;
      rawContent: string | null;
    };

export function glitterCompletionArtifact<Response>(input: {
  model: string;
  parsed: Response | null | undefined;
  rawContent: string | null;
  usage: OpenAI.Completions.CompletionUsage | undefined;
  missingParsedError: string;
}): {
  response: GlitterCompletionArtifact<Response>;
  usage: GenerationUsage;
} {
  const usage = glitterCompletionUsage({
    model: input.model,
    usage: input.usage,
  });
  return {
    response:
      input.parsed === null || input.parsed === undefined
        ? {
            outcome: "failure",
            error: input.missingParsedError,
            rawContent: input.rawContent,
          }
        : { outcome: "success", value: input.parsed },
    usage,
  };
}

export function useGlitterCompletionArtifact<Response>(input: {
  artifact: GenerationArtifactResult<GlitterCompletionArtifact<Response>>;
  budget: GenerationBudget;
}): Response {
  input.budget.record(input.artifact);
  if (input.artifact.response.outcome === "failure") {
    throw new Error(input.artifact.response.error);
  }
  return input.artifact.response.value;
}
