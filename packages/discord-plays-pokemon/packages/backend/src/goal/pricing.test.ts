import { describe, expect, test } from "bun:test";
import {
  addUsage,
  computeCost,
  EMPTY_USAGE,
  formatCostLine,
  type TurnUsage,
} from "./pricing.ts";

const usage = (partial: Partial<TurnUsage>): TurnUsage => ({
  ...EMPTY_USAGE,
  ...partial,
});

describe("computeCost", () => {
  test("returns null for unknown models so we don't invent prices", () => {
    expect(computeCost("gpt-7.0-unicorn", usage({ inputTokens: 1000 }))).toBe(
      null,
    );
  });

  test("bills uncached input tokens at the full input rate", () => {
    const cost = computeCost("gpt-5.4-nano", usage({ inputTokens: 1_000_000 }));
    expect(cost).toBeCloseTo(0.2, 6);
  });

  test("bills cached input tokens at the cached rate (10% of full)", () => {
    // 1M input tokens, all cached → $0.02 instead of $0.20.
    const cost = computeCost(
      "gpt-5.4-nano",
      usage({ inputTokens: 1_000_000, cachedInputTokens: 1_000_000 }),
    );
    expect(cost).toBeCloseTo(0.02, 6);
  });

  test("bills output + reasoning tokens at the output rate", () => {
    const cost = computeCost(
      "gpt-5.4-nano",
      usage({ outputTokens: 500_000, reasoningOutputTokens: 500_000 }),
    );
    expect(cost).toBeCloseTo(1.25, 6);
  });

  test("mixed turn ≈ matches hand math for gpt-5.4-nano", () => {
    // 20k input (5k cached), 1k output, 500 reasoning.
    const cost = computeCost(
      "gpt-5.4-nano",
      usage({
        inputTokens: 20_000,
        cachedInputTokens: 5000,
        outputTokens: 1000,
        reasoningOutputTokens: 500,
      }),
    );
    // (15_000 * 0.20 + 5_000 * 0.02 + 1_500 * 1.25) / 1e6
    expect(cost).toBeCloseTo(0.004_975, 6);
  });

  test("mini is ~3.7× more expensive than nano for the same workload", () => {
    const fixed = usage({
      inputTokens: 100_000,
      cachedInputTokens: 10_000,
      outputTokens: 5000,
    });
    const nano = computeCost("gpt-5.4-nano", fixed);
    const mini = computeCost("gpt-5.4-mini", fixed);
    expect(nano).not.toBeNull();
    expect(mini).not.toBeNull();
    if (nano === null || mini === null) {
      throw new Error("unreachable: computeCost returned null for known model");
    }
    expect(mini / nano).toBeCloseTo(3.71, 1);
  });
});

describe("formatCostLine", () => {
  test("renders cost + tokens for a known model", () => {
    const line = formatCostLine(
      "gpt-5.4-nano",
      0.0123,
      usage({ inputTokens: 12_345, outputTokens: 678 }),
    );
    expect(line).toBe("Cost: $0.01 (Tokens: 12,345 in / 678 out)");
  });

  test("uses 4-decimal precision when cost is sub-cent", () => {
    const line = formatCostLine(
      "gpt-5.4-nano",
      0.000_12,
      usage({ inputTokens: 100, outputTokens: 50 }),
    );
    expect(line).toContain("$0.0001");
  });

  test("falls back to a tokens-only line when no rate is on file", () => {
    const line = formatCostLine(
      "gpt-7.0-unicorn",
      null,
      usage({ inputTokens: 12, outputTokens: 34 }),
    );
    expect(line).toBe(
      "Tokens: 12 in / 34 out (no list price on file for gpt-7.0-unicorn)",
    );
  });

  test("counts reasoning tokens as output in the human-readable line", () => {
    const line = formatCostLine(
      "gpt-5.4-nano",
      0.001,
      usage({ inputTokens: 1, outputTokens: 10, reasoningOutputTokens: 20 }),
    );
    expect(line).toContain("1 in / 30 out");
  });
});

describe("addUsage", () => {
  test("sums each token category independently", () => {
    const total = addUsage(
      usage({ inputTokens: 10, cachedInputTokens: 5, outputTokens: 1 }),
      usage({
        inputTokens: 20,
        cachedInputTokens: 5,
        outputTokens: 2,
        reasoningOutputTokens: 3,
      }),
    );
    expect(total).toEqual({
      inputTokens: 30,
      cachedInputTokens: 10,
      outputTokens: 3,
      reasoningOutputTokens: 3,
    });
  });
});
