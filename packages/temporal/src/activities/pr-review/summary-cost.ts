import type Anthropic from "@anthropic-ai/sdk";
import { costForTextUsage } from "@shepherdjerred/llm-models";

// The SDK summary path runs on Haiku 4.5. Pricing lives in the central catalog;
// both haiku ids carry identical rates, so either resolves the same cost.
const SUMMARY_COST_MODEL = "claude-haiku-4-5";

export function estimateCostUsd(usage: Anthropic.Usage): number {
  return (
    costForTextUsage(SUMMARY_COST_MODEL, {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    }) ?? 0
  );
}
