import OpenAI from "openai";
import { z } from "zod/v4";
import {
  traceOpenAi,
  type TraceOpenAiMetadata,
} from "@shepherdjerred/llm-observability";
import {
  type GenerationBudget,
  openAiGenerationUsage,
} from "./glitter-context-refresh-budget.ts";
import type {
  GenerationArtifactResult,
  GenerationUsage,
} from "./glitter-context-refresh-cache.ts";

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
  if (input.usage === undefined) {
    throw new Error(`OpenAI returned no usage for ${input.model}`);
  }
  return openAiGenerationUsage({
    model: input.model,
    promptTokens: input.usage.prompt_tokens,
    completionTokens: input.usage.completion_tokens,
    cachedPromptTokens: input.usage.prompt_tokens_details?.cached_tokens ?? 0,
  });
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
