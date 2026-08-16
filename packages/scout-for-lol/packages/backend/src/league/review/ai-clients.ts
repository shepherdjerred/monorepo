import { generateImage, generateText } from "ai";
import type {
  ImageGenerationClient,
  TextGenerationClient,
} from "@scout-for-lol/data";
import {
  createOpenRouterRuntime,
  parseOpenRouterMetadata,
  type OpenRouterRuntime,
} from "@shepherdjerred/llm-runtime";
import {
  serializeBodyAttribute,
  withLlmSpan,
} from "@shepherdjerred/llm-observability/span-helpers";
import config from "#src/configuration.ts";
import { registry } from "#src/metrics/registry.ts";
import {
  assertWithinBudget,
  recordTokenUsage,
} from "#src/league/review/openai-budget.ts";

let cachedRuntime: OpenRouterRuntime | undefined;

export function getOpenRouterRuntime(): OpenRouterRuntime | undefined {
  if (config.openRouterApiKey === undefined) return undefined;
  cachedRuntime ??= createOpenRouterRuntime({
    apiKey: config.openRouterApiKey,
    service: "scout-for-lol-backend",
    appName: "Scout for LoL",
    metricsRegister: registry,
  });
  return cachedRuntime;
}

export function getTextGenerationClient(): TextGenerationClient | undefined {
  const runtime = getOpenRouterRuntime();
  if (runtime === undefined) return undefined;
  return {
    generate: async (params) => {
      assertWithinBudget();
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
      const inputTokens = result.usage.inputTokens ?? 0;
      const outputTokens = result.usage.outputTokens ?? 0;
      const metadata = parseOpenRouterMetadata({
        requestedModel: params.model,
        responseId: result.finalStep.response.id,
        resolvedModel: result.finalStep.response.modelId,
        usage: result.usage,
        providerMetadata: result.finalStep.providerMetadata,
        responseBody: result.finalStep.response.body,
      });
      recordTokenUsage(inputTokens, outputTokens, params.model);
      return {
        text: result.text,
        finishReason: result.finishReason,
        inputTokens,
        outputTokens,
        openRouter: metadata,
      };
    },
  };
}

export function getImageGenerationClient(): ImageGenerationClient | undefined {
  const runtime = getOpenRouterRuntime();
  if (runtime === undefined) return undefined;
  return {
    generate: async (params) =>
      await withLlmSpan(
        {
          service: runtime.service,
          callSite: params.workload,
          system: "openrouter",
        },
        {
          model: params.model,
          maxTokens: undefined,
          temperature: undefined,
          topP: undefined,
          stopSequences: undefined,
        },
        async (span) => {
          span.setAttribute(
            "gen_ai.input.messages",
            serializeBodyAttribute({ prompt: params.prompt }),
          );
          const { headers } = runtime.callOptions({
            workload: params.workload,
          });
          const result = await generateImage({
            model: runtime.imageModel(params.model),
            prompt: params.prompt,
            abortSignal: AbortSignal.timeout(params.timeoutMs),
            headers,
          });
          span.setAttribute(
            "gen_ai.output.messages",
            serializeBodyAttribute({
              base64: result.image.base64,
              mediaType: result.image.mediaType,
            }),
          );
          return { imageBase64: result.image.base64 };
        },
      ),
  };
}

export function resetAiClientsForTests(): void {
  cachedRuntime = undefined;
}
