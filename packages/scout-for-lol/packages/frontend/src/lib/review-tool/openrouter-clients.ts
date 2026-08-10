import { generateImage, generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type {
  ImageGenerationClient,
  TextGenerationClient,
} from "@scout-for-lol/data";
import { requireOpenRouterRoute } from "@shepherdjerred/llm-models";
import { parseOpenRouterMetadata } from "@shepherdjerred/llm-runtime/metadata";

function settings(requireParameters: boolean) {
  return {
    usage: { include: true },
    structuredOutputs: { strict: true },
    provider: {
      allow_fallbacks: true,
      data_collection: "deny" as const,
      require_parameters: requireParameters,
    },
  };
}

export function createReviewWorkbenchClients(apiKey: string): {
  text: TextGenerationClient;
  image: ImageGenerationClient;
} {
  if (apiKey.trim().length === 0) {
    throw new Error("OpenRouter API key is required");
  }
  const provider = createOpenRouter({
    apiKey,
    appName: "Scout Review Workbench",
    compatibility: "strict",
    headers: { "X-OpenRouter-Metadata": "enabled" },
  });
  return {
    text: {
      generate: async (params) => {
        const route = requireOpenRouterRoute(params.model, "language");
        const result = await generateText({
          model: provider.chat(route.modelId, settings(false)),
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
          openRouter: parseOpenRouterMetadata({
            requestedModel: params.model,
            responseId: result.finalStep.response.id,
            resolvedModel: result.finalStep.response.modelId,
            usage: result.usage,
            providerMetadata: result.finalStep.providerMetadata,
            responseBody: result.finalStep.response.body,
          }),
        };
      },
    },
    image: {
      generate: async (params) => {
        const route = requireOpenRouterRoute(params.model, "image");
        const result = await generateImage({
          model: provider.imageModel(route.modelId, settings(false)),
          prompt: params.prompt,
          abortSignal: AbortSignal.timeout(params.timeoutMs),
        });
        return { imageBase64: result.image.base64 };
      },
    },
  };
}
