import OpenAI from "openai";
import {
  GoogleGenerativeAI,
  GenerativeModel,
  type ModelParams,
  type RequestOptions,
  type GenerateContentRequest,
  type Part,
  type SingleRequestOptions,
} from "@google/generative-ai";
import type { OpenAIClient } from "@scout-for-lol/data";
import { traceGemini, traceOpenAi } from "@shepherdjerred/llm-observability";
import config from "#src/configuration.ts";
import {
  assertWithinBudget,
  recordTokenUsage,
} from "#src/league/review/openai-budget.ts";

/**
 * Initialize OpenAI client if API key is configured.
 *
 * The returned client is wrapped with a token-budget circuit breaker:
 *   - Before each call: throws `OpenAIBudgetExceeded` if the hourly or daily
 *     token budget would be breached (`assertWithinBudget`).
 *   - After each call: records prompt + completion tokens to in-memory
 *     counters and Prometheus metrics (`recordTokenUsage`).
 *   - Around each call: emits a `gen_ai.chat` span with bodies offloaded to
 *     SeaweedFS by the archive span processor (`traceOpenAi`).
 *
 * Wrapping at construction (not at the call site) means every consumer of
 * the client — including future code paths we haven't written — is covered
 * automatically. The wrapper conforms to the data package's structural
 * `OpenAIClient` interface, which is the contract used by the pipeline.
 */
export function getOpenAIClient(): OpenAIClient | undefined {
  if (config.openaiApiKey === undefined) {
    return undefined;
  }
  const inner = new OpenAI({ apiKey: config.openaiApiKey });

  return {
    chat: {
      completions: {
        create: async (params) => {
          assertWithinBudget();
          const response = await traceOpenAi(
            {
              service: "scout-backend",
              callSite: "scout-review",
              request: params,
            },
            async () => inner.chat.completions.create(params),
          );
          const promptTokens = response.usage?.prompt_tokens ?? 0;
          const completionTokens = response.usage?.completion_tokens ?? 0;
          recordTokenUsage(promptTokens, completionTokens, params.model);
          return response;
        },
      },
    },
  };
}

/**
 * GenerativeModel subclass that traces `generateContent` calls. Inherits every
 * other method (including `generateContentStream`, `countTokens`, etc.)
 * unchanged.
 */
class TracedGenerativeModel extends GenerativeModel {
  override generateContent(
    request: GenerateContentRequest | string | (string | Part)[],
    requestOptions?: SingleRequestOptions,
  ): ReturnType<GenerativeModel["generateContent"]> {
    const contents = normalizeGeminiContents(request);
    return traceGemini(
      {
        service: "scout-backend",
        callSite: "scout-review",
        request: { model: this.model, contents },
      },
      async () => super.generateContent(request, requestOptions),
    );
  }
}

/**
 * GoogleGenerativeAI subclass that hands out `TracedGenerativeModel` instances
 * instead of the plain `GenerativeModel`. Subclassing instead of Proxy keeps
 * the type system happy without resorting to `Reflect.get` (which returns
 * `any` and trips `@typescript-eslint/no-unsafe-return`).
 */
class TracedGoogleGenerativeAI extends GoogleGenerativeAI {
  override getGenerativeModel(
    modelParams: ModelParams,
    requestOptions?: RequestOptions,
  ): GenerativeModel {
    return new TracedGenerativeModel(this.apiKey, modelParams, requestOptions);
  }
}

/**
 * Initialize Gemini client if API key is configured.
 *
 * The returned client is a `TracedGoogleGenerativeAI` subclass that intercepts
 * `getGenerativeModel(...).generateContent(...)` to emit a `gen_ai.chat` span
 * and offload the request/response bodies to SeaweedFS via the archive span
 * processor.
 */
export function getGeminiClient(): GoogleGenerativeAI | undefined {
  if (config.geminiApiKey === undefined) {
    return undefined;
  }
  return new TracedGoogleGenerativeAI(config.geminiApiKey);
}

function normalizeGeminiContents(
  request: GenerateContentRequest | string | (string | Part)[],
): { role: string; parts: unknown[] }[] {
  if (typeof request === "string") {
    return [{ role: "user", parts: [{ text: request }] }];
  }
  if (Array.isArray(request)) {
    return [{ role: "user", parts: request }];
  }
  return [
    {
      role: "user",
      parts: Array.isArray(request.contents)
        ? request.contents
        : [request.contents],
    },
  ];
}
