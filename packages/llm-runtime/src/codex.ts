import { requireOpenRouterRoute } from "@shepherdjerred/llm-models";

export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";

export type OpenRouterCodexProviderConfig = {
  model_provider: "openrouter";
  model_providers: {
    openrouter: {
      name: "OpenRouter";
      base_url: string;
      wire_api: "responses";
      /**
       * The Codex SDK injects `codexOptions.apiKey` as `CODEX_API_KEY` in
       * the CLI environment, which this key reads back. (OpenRouter's auth
       * command also refreshes the model catalog; `env_key` skips that, so
       * model IDs must already be exact OpenRouter slugs — which
       * `routeModelId` is.)
       */
      env_key: "CODEX_API_KEY";
    };
  };
};

export type OpenRouterCodexConfig = {
  catalogModelId: string;
  routeModelId: string;
  codexOptions: {
    apiKey: string;
    baseUrl: string;
    env?: Record<string, string>;
  };
  /**
   * Custom-provider block for the Codex `config` option. Overriding the
   * built-in `openai` provider's base URL does not route through OpenRouter:
   * the CLI treats that provider as OpenAI and opens a Responses websocket
   * (`wss://openrouter.ai/api/v1/responses`) that OpenRouter 404s. A named
   * provider with `wire_api = "responses"` uses plain HTTPS instead, per
   * OpenRouter's Codex CLI setup guide.
   */
  providerConfig: OpenRouterCodexProviderConfig;
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
    providerConfig: {
      model_provider: "openrouter",
      model_providers: {
        openrouter: {
          name: "OpenRouter",
          base_url: OPENROUTER_API_BASE_URL,
          wire_api: "responses",
          env_key: "CODEX_API_KEY",
        },
      },
    },
  };
}
