import type Anthropic from "@anthropic-ai/sdk";

const HAIKU_PRICING = {
  inputPerMillionUsd: 1,
  outputPerMillionUsd: 5,
  cacheReadPerMillionUsd: 0.1,
  cacheWritePerMillionUsd: 1.25,
} as const;

export function estimateCostUsd(usage: Anthropic.Usage): number {
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;

  return (
    (inputTokens * HAIKU_PRICING.inputPerMillionUsd) / 1_000_000 +
    (outputTokens * HAIKU_PRICING.outputPerMillionUsd) / 1_000_000 +
    (cacheRead * HAIKU_PRICING.cacheReadPerMillionUsd) / 1_000_000 +
    (cacheWrite * HAIKU_PRICING.cacheWritePerMillionUsd) / 1_000_000
  );
}
