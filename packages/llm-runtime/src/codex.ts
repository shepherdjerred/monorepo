import { requireOpenRouterRoute } from "@shepherdjerred/llm-models";

export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";

export type OpenRouterCodexConfig = {
  catalogModelId: string;
  routeModelId: string;
  codexOptions: {
    apiKey: string;
    baseUrl: string;
    env?: Record<string, string>;
  };
};

export function createOpenRouterCodexConfig(input: {
  apiKey: string;
  modelId: string;
  env?: Record<string, string>;
}): OpenRouterCodexConfig {
  if (input.apiKey.trim() === "") {
    throw new Error("OpenRouter API key must not be empty");
  }
  const route = requireOpenRouterRoute(input.modelId, "language");
  return {
    catalogModelId: input.modelId,
    routeModelId: route.modelId,
    codexOptions: {
      apiKey: input.apiKey,
      baseUrl: OPENROUTER_API_BASE_URL,
      ...(input.env === undefined ? {} : { env: input.env }),
    },
  };
}
