import { generateText } from "ai";
import type { TextGenerationClient } from "@scout-for-lol/data";
import {
  createOpenRouterRuntime,
  parseOpenRouterMetadata,
} from "@shepherdjerred/llm-runtime";

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function createOpenRouterClient(
  apiKey: string,
  fetcher: Fetcher = fetch,
): TextGenerationClient {
  if (apiKey.trim() === "") {
    throw new Error("OPENROUTER_API_KEY must not be empty");
  }
  const runtime = createOpenRouterRuntime({
    apiKey,
    service: "scout-review-evals",
    appName: "Scout Review Evals",
    fetch: fetcher,
  });
  return {
    generate: async (params) => {
      const result = await generateText({
        model: runtime.languageModel(params.model),
        ...(params.systemPrompt === undefined
          ? {}
          : { system: params.systemPrompt }),
        prompt: params.userPrompt,
        maxOutputTokens: params.maxOutputTokens,
        ...(params.temperature === undefined
          ? {}
          : { temperature: params.temperature }),
        ...(params.topP === undefined ? {} : { topP: params.topP }),
        ...runtime.callOptions({ workload: params.workload }),
      });
      const metadata = parseOpenRouterMetadata({
        requestedModel: params.model,
        responseId: result.finalStep.response.id,
        resolvedModel: result.finalStep.response.modelId,
        usage: result.usage,
        providerMetadata: result.finalStep.providerMetadata,
        responseBody: result.finalStep.response.body,
      });
      return {
        text: result.text,
        finishReason: result.finishReason,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        openRouter: metadata,
      };
    },
  };
}
