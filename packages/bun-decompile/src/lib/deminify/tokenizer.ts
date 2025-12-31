/**
 * Tokenizer module for accurate token counting across different LLM providers.
 *
 * Uses tiktoken for OpenAI models and @anthropic-ai/tokenizer for Claude models.
 */

import { encoding_for_model, type TiktokenModel } from "tiktoken";
import { countTokens as anthropicCountTokens } from "@anthropic-ai/tokenizer";

// =============================================================================
// Model Context Limits (input tokens)
// =============================================================================

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // OpenAI GPT-4o series
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4o-2024-11-20": 128_000,
  "gpt-4o-2024-08-06": 128_000,
  "gpt-4o-mini-2024-07-18": 128_000,

  // OpenAI GPT-4.1 series (latest)
  "gpt-4.1": 1_000_000,
  "gpt-4.1-mini": 1_000_000,
  "gpt-4.1-nano": 1_000_000,

  // OpenAI GPT-4.5
  "gpt-4.5-preview": 128_000,

  // OpenAI GPT-5 series
  "gpt-5": 128_000,
  "gpt-5-mini": 128_000,
  "gpt-5-nano": 128_000,

  // OpenAI o1/o3 reasoning models
  "o1": 200_000,
  "o1-mini": 128_000,
  "o1-preview": 128_000,
  "o3": 200_000,
  "o3-mini": 200_000,

  // Anthropic Claude 3.5 series
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3-5-haiku": 200_000,

  // Anthropic Claude 4 series (latest)
  "claude-sonnet-4-20250514": 1_000_000,
  "claude-opus-4-20250514": 200_000,
  "claude-sonnet-4": 1_000_000,
  "claude-opus-4": 200_000,

  // Anthropic Claude 3 series (older)
  "claude-3-opus-20240229": 200_000,
  "claude-3-sonnet-20240229": 200_000,
  "claude-3-haiku-20240307": 200_000,
};

// Map model names to tiktoken encoding names
const TIKTOKEN_MODEL_MAP: Record<string, TiktokenModel> = {
  "gpt-4o": "gpt-4o",
  "gpt-4o-mini": "gpt-4o-mini",
  "gpt-4o-2024-11-20": "gpt-4o",
  "gpt-4o-2024-08-06": "gpt-4o",
  "gpt-4o-mini-2024-07-18": "gpt-4o-mini",
  // GPT-4.1/4.5/5 likely use same tokenizer as GPT-4o
  "gpt-4.1": "gpt-4o",
  "gpt-4.1-mini": "gpt-4o",
  "gpt-4.1-nano": "gpt-4o",
  "gpt-4.5-preview": "gpt-4o",
  "gpt-5": "gpt-4o",
  "gpt-5-mini": "gpt-4o",
  "gpt-5-nano": "gpt-4o",
  // o1/o3 models
  "o1": "gpt-4o",
  "o1-mini": "gpt-4o",
  "o1-preview": "gpt-4o",
  "o3": "gpt-4o",
  "o3-mini": "gpt-4o",
};

// Cache for tiktoken encoders
const encoderCache = new Map<string, ReturnType<typeof encoding_for_model>>();

/**
 * Get or create a tiktoken encoder for a model.
 */
function getTiktokenEncoder(model: string): ReturnType<typeof encoding_for_model> {
  const tiktokenModel = TIKTOKEN_MODEL_MAP[model] ?? "gpt-4o";

  if (!encoderCache.has(tiktokenModel)) {
    encoderCache.set(tiktokenModel, encoding_for_model(tiktokenModel));
  }

  return encoderCache.get(tiktokenModel)!;
}

/**
 * Check if a model is an Anthropic/Claude model.
 */
function isClaudeModel(model: string): boolean {
  return model.toLowerCase().includes("claude");
}

/**
 * Check if a model is an OpenAI model.
 */
function isOpenAIModel(model: string): boolean {
  const lower = model.toLowerCase();
  return (
    lower.includes("gpt") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.includes("davinci") ||
    lower.includes("turbo")
  );
}

/**
 * Count the number of tokens in a text string for a given model.
 *
 * Uses tiktoken for OpenAI models and @anthropic-ai/tokenizer for Claude models.
 */
export function countTokens(text: string, model: string): number {
  if (isClaudeModel(model)) {
    return anthropicCountTokens(text);
  }

  if (isOpenAIModel(model)) {
    const encoder = getTiktokenEncoder(model);
    return encoder.encode(text).length;
  }

  // Fallback: rough estimate (4 chars per token)
  return Math.ceil(text.length / 4);
}

/**
 * Get the context window limit for a model.
 *
 * Returns the maximum number of input tokens the model can handle.
 */
export function getContextLimit(model: string): number {
  // Check exact match first
  if (MODEL_CONTEXT_LIMITS[model]) {
    return MODEL_CONTEXT_LIMITS[model];
  }

  // Check partial matches
  const lower = model.toLowerCase();
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return limit;
    }
  }

  // Default fallback
  if (isClaudeModel(model)) {
    return 200_000; // Claude default
  }

  return 128_000; // OpenAI default
}

/**
 * Calculate the target batch token budget for a model.
 *
 * @param model - The model name
 * @param utilizationPct - Target utilization percentage (default 0.9 = 90%)
 * @param reserveForOutput - Tokens to reserve for output (default 16384)
 * @returns The target number of input tokens per batch
 */
export function getTargetBatchTokens(
  model: string,
  utilizationPct: number = 0.9,
  reserveForOutput: number = 16_384
): number {
  const contextLimit = getContextLimit(model);

  // Reserve space for output tokens
  const availableForInput = contextLimit - reserveForOutput;

  // Apply utilization percentage
  return Math.floor(availableForInput * utilizationPct);
}

/**
 * Get model information for display/logging.
 */
export function getModelInfo(model: string): {
  contextLimit: number;
  targetBatchTokens: number;
  provider: "openai" | "anthropic" | "unknown";
} {
  return {
    contextLimit: getContextLimit(model),
    targetBatchTokens: getTargetBatchTokens(model),
    provider: isClaudeModel(model) ? "anthropic" : isOpenAIModel(model) ? "openai" : "unknown",
  };
}

