import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { MastraModelConfig } from "@mastra/core/llm";

export function resolveFleetModel(
  model: string,
  baseUrl: string | undefined,
  apiKeyEnvironment: string | undefined,
): MastraModelConfig {
  if (!model.startsWith("openai-compatible/")) {
    if (baseUrl !== undefined || apiKeyEnvironment !== undefined) {
      throw new Error(
        "--base-url and --api-key-env are only valid with openai-compatible/<model>",
      );
    }
    const openAiApiKey = Bun.env["OPENAI_API_KEY"];
    if (
      model.startsWith("openai/") &&
      (openAiApiKey === undefined || openAiApiKey.length === 0)
    ) {
      throw new Error("OPENAI_API_KEY is required for openai/* models");
    }
    return model;
  }
  if (baseUrl === undefined || apiKeyEnvironment === undefined) {
    throw new Error(
      "openai-compatible models require --base-url and --api-key-env",
    );
  }
  const apiKey = Bun.env[apiKeyEnvironment];
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(
      `API key environment variable is empty: ${apiKeyEnvironment}`,
    );
  }
  const modelId = model.slice("openai-compatible/".length);
  return createOpenAICompatible({
    baseURL: baseUrl,
    name: "pr-fleet-compatible",
    apiKey,
  }).chatModel(modelId);
}
