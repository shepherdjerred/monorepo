import { getPerTokenPricing } from "@shepherdjerred/llm-models";

export type UsageSummary = {
  calls: number;
  cachedCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
};

type UsageTracker = {
  record: (inputTokens: number, outputTokens: number) => void;
  recordCached: (inputTokens: number, outputTokens: number) => void;
  getSummary: () => UsageSummary;
};

// Pricing comes from the central catalog (@shepherdjerred/llm-models).
// Monarch defaults to Sonnet; fall back to its pricing for unknown models.
const FALLBACK_MODEL = "claude-sonnet-4-6";

export function createUsageTracker(model: string): UsageTracker {
  const pricing =
    getPerTokenPricing(model) ?? getPerTokenPricing(FALLBACK_MODEL);
  if (pricing === undefined) {
    throw new Error(
      `No catalog pricing for model "${model}" or fallback "${FALLBACK_MODEL}"`,
    );
  }
  let calls = 0;
  let cachedCalls = 0;
  let totalInput = 0;
  let totalOutput = 0;

  return {
    record(inputTokens: number, outputTokens: number): void {
      calls++;
      totalInput += inputTokens;
      totalOutput += outputTokens;
    },
    recordCached(inputTokens: number, outputTokens: number): void {
      cachedCalls++;
      totalInput += inputTokens;
      totalOutput += outputTokens;
    },
    getSummary(): UsageSummary {
      return {
        calls,
        cachedCalls,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        estimatedCost:
          totalInput * pricing.input + totalOutput * pricing.output,
      };
    },
  };
}
