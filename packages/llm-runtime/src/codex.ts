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
import { z } from "zod";

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

/** Check the native credential and catalog model before starting a coding turn. */
export async function checkCodexModelAccess(
  input: { apiKey: string; modelId: string },
  request: typeof fetch = fetch,
): Promise<void> {
  const { routeModelId } = createCodexConfig(input);
  const response = await request(
    `https://api.openai.com/v1/models/${encodeURIComponent(routeModelId)}`,
    {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    // Provider error bodies can echo credentials; expose only the HTTP status.
    throw new Error(
      `OpenAI model access failed (HTTP ${String(response.status)}). Codex needs a native OpenAI credential with access to the configured model.`,
    );
  }
  const model = z.object({ id: z.string() }).parse(await response.json());
  if (model.id !== routeModelId)
    throw new Error("OpenAI returned a different model");
}
