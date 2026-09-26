/**
 * Configuration for the Codex SDK, pointed at OpenAI directly.
 *
 * The Codex SDK speaks the OpenAI API, so under the gateway this had to
 * override the base URL to OpenRouter and translate the catalog id into a
 * gateway route. Against OpenAI itself neither is needed: the catalog's native
 * route id IS the API model name, and the SDK's default base URL is already
 * correct — so no `baseUrl` is set, and the SDK is free to follow its own
 * default if OpenAI ever moves it.
 */
import { requireNativeRoute } from "@shepherdjerred/llm-models";

export type CodexConfig = {
  catalogModelId: string;
  routeModelId: string;
  codexOptions: {
    apiKey: string;
    env?: Record<string, string>;
  };
};

export function createCodexConfig(input: {
  apiKey: string;
  modelId: string;
  env?: Record<string, string>;
}): CodexConfig {
  if (input.apiKey.trim() === "") {
    throw new Error("OpenAI API key must not be empty");
  }
  const route = requireNativeRoute(input.modelId, "language");
  if (route.provider !== "openai") {
    throw new Error(
      `Codex requires an OpenAI model; ${input.modelId} routes to ${route.provider}`,
    );
  }
  return {
    catalogModelId: input.modelId,
    routeModelId: route.modelId,
    codexOptions: {
      apiKey: input.apiKey,
      ...(input.env === undefined ? {} : { env: input.env }),
    },
  };
}
