import { z } from "zod";

/** Building blocks shared by every `/v1/*` response contract. */

export const HISTORY_API_VERSION = 1;

export const ApiVersionSchema = z.literal(HISTORY_API_VERSION);

/** Every timestamp is ISO 8601; sources normalize before indexing. */
export const TimestampSchema = z.iso.datetime({ offset: true });

export const TokenCountSchema = z.number().int().nonnegative();

/**
 * Token counts shared by session and captured-request usage. Anthropic cache
 * reads and writes are additive; OpenAI `cachedInputTokens` is the cached
 * subset of `inputTokens`.
 */
export const TOKEN_COUNT_FIELDS = {
  inputTokens: TokenCountSchema,
  outputTokens: TokenCountSchema,
  cacheReadTokens: TokenCountSchema,
  cacheCreationTokens: TokenCountSchema,
  cachedInputTokens: TokenCountSchema,
  reasoningTokens: TokenCountSchema,
};
