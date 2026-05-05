import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { OpenAIClient } from "@scout-for-lol/data";
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
          const response = await inner.chat.completions.create(params);
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
 * Initialize Gemini client if API key is configured
 */
export function getGeminiClient(): GoogleGenerativeAI | undefined {
  if (config.geminiApiKey === undefined) {
    return undefined;
  }
  return new GoogleGenerativeAI(config.geminiApiKey);
}
