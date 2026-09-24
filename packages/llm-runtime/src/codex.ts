/**
 * Configuration for the Codex SDK, pointed at OpenAI directly.
 *
 * The Codex SDK speaks the OpenAI API, so under the gateway this had to
 * override the base URL to OpenRouter and translate the model id to a gateway
 * route. Against OpenAI itself neither is needed: the catalog's native route id
 * IS the API model name, and the default base URL is correct.
 */
import { requireNativeRoute } from "@shepherdjerred/llm-models";

export type CodexConfig = {
  readonly apiKey: string;
  readonly model: string;
  readonly env: Record<string, string>;
};

export function createCodexConfig(input: {
  apiKey: string;
  modelId: string;
  env?: Record<string, string> | undefined;
}): CodexConfig {
  const route = requireNativeRoute(input.modelId, "language");
  if (route.provider !== "openai") {
    throw new Error(
      `Codex requires an OpenAI model; ${input.modelId} routes to ${route.provider}`,
    );
  }
  return {
    apiKey: input.apiKey,
    model: route.modelId,
    env: { ...input.env, OPENAI_API_KEY: input.apiKey },
  };
}
