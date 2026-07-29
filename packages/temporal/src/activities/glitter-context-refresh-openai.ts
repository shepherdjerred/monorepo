import OpenAI from "openai";
import {
  traceOpenAi,
  type TraceOpenAiMetadata,
} from "@shepherdjerred/llm-observability";
import { openAiGenerationUsage } from "./glitter-context-refresh-budget.ts";
import type { GenerationUsage } from "./glitter-context-refresh-cache.ts";

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
