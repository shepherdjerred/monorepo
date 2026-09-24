import { generateImage, generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  ImageGenerationClient,
  TextGenerationClient,
} from "@scout-for-lol/data";
import { requireNativeRoute } from "@shepherdjerred/llm-models";

/**
 * Keys the operator types into the workbench. They stay in the browser and are
 * never sent anywhere but the provider.
 *
 * Google is the Gemini API rather than Vertex, which the rest of the repo uses.
 * Vertex authenticates with OAuth against a service account, which a browser
 * cannot hold; the Gemini API takes a key the operator already has. This is the
 * operator's own credential, not repo-managed infrastructure, so it sits
 * outside the Vertex decision entirely.
 */
export type WorkbenchApiKeys = {
  openai?: string | undefined;
  anthropic?: string | undefined;
  google?: string | undefined;
};

function requireKey(
  keys: WorkbenchApiKeys,
  provider: "openai" | "anthropic" | "google",
): string {
  const key = keys[provider]?.trim();
  if (key === undefined || key === "") {
    throw new Error(`A ${provider} API key is required for this model`);
  }
  return key;
}

function languageModel(keys: WorkbenchApiKeys, modelId: string) {
  const route = requireNativeRoute(modelId, "language");
  switch (route.provider) {
    case "openai": {
      return createOpenAI({ apiKey: requireKey(keys, "openai") }).languageModel(
        route.modelId,
      );
    }
    case "anthropic": {
      return createAnthropic({
        apiKey: requireKey(keys, "anthropic"),
        // Anthropic blocks browser calls unless the caller opts in. The
        // workbench is a local operator tool with the operator's own key, which
        // is the case this header exists for.
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      }).languageModel(route.modelId);
    }
    case "google": {
      return createGoogleGenerativeAI({
        apiKey: requireKey(keys, "google"),
      }).languageModel(route.modelId);
    }
  }
}

export function createReviewWorkbenchClients(keys: WorkbenchApiKeys): {
  text: TextGenerationClient;
  image: ImageGenerationClient;
} {
  return {
    text: {
      generate: async (params) => {
        const route = requireNativeRoute(params.model, "language");
        const result = await generateText({
          model: languageModel(keys, params.model),
          ...(params.systemPrompt === undefined
            ? {}
            : { system: params.systemPrompt }),
          prompt: params.userPrompt,
          maxOutputTokens: params.maxOutputTokens,
          ...(params.temperature === undefined
            ? {}
            : { temperature: params.temperature }),
          ...(params.topP === undefined ? {} : { topP: params.topP }),
        });
        return {
          text: result.text,
          finishReason: result.finishReason,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          provider: {
            provider: route.provider,
            responseId: result.finalStep.response.id,
            requestedModel: params.model,
            resolvedModel: result.finalStep.response.modelId,
          },
        };
      },
    },
    image: {
      generate: async (params) => {
        const route = requireNativeRoute(params.model, "image");
        if (route.provider !== "google") {
          throw new Error(
            `Image model ${params.model} routes to ${route.provider}, which the workbench does not support`,
          );
        }
        const result = await generateImage({
          model: createGoogleGenerativeAI({
            apiKey: requireKey(keys, "google"),
          }).imageModel(route.modelId),
          prompt: params.prompt,
          abortSignal: AbortSignal.timeout(params.timeoutMs),
        });
        return { imageBase64: result.image.base64 };
      },
    },
  };
}
