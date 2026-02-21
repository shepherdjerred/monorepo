export type UsageSummary = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
};

type UsageTracker = {
  record: (inputTokens: number, outputTokens: number) => void;
  getSummary: () => UsageSummary;
};

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  "claude-haiku-3-5-20241022": { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
};

const DEFAULT_PRICING = { input: 3 / 1_000_000, output: 15 / 1_000_000 };

export function createUsageTracker(model: string): UsageTracker {
  const pricing = PRICING[model] ?? DEFAULT_PRICING;
  let calls = 0;
  let totalInput = 0;
  let totalOutput = 0;

  return {
    record(inputTokens: number, outputTokens: number): void {
      calls++;
      totalInput += inputTokens;
      totalOutput += outputTokens;
    },
    getSummary(): UsageSummary {
      return {
        calls,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        estimatedCost:
          totalInput * pricing.input + totalOutput * pricing.output,
      };
    },
  };
}
