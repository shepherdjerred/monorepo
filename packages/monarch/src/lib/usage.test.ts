import { describe, test, expect } from "bun:test";
import { createUsageTracker } from "./usage.ts";

describe("createUsageTracker", () => {
  test("starts with zero counts", () => {
    const tracker = createUsageTracker("claude-sonnet-4-20250514");
    const summary = tracker.getSummary();
    expect(summary.calls).toBe(0);
    expect(summary.inputTokens).toBe(0);
    expect(summary.outputTokens).toBe(0);
    expect(summary.estimatedCost).toBe(0);
  });

  test("accumulates usage across multiple calls", () => {
    const tracker = createUsageTracker("claude-sonnet-4-20250514");
    tracker.record(1000, 500);
    tracker.record(2000, 300);
    const summary = tracker.getSummary();
    expect(summary.calls).toBe(2);
    expect(summary.inputTokens).toBe(3000);
    expect(summary.outputTokens).toBe(800);
  });

  test("calculates cost for sonnet model", () => {
    const tracker = createUsageTracker("claude-sonnet-4-20250514");
    tracker.record(1_000_000, 100_000);
    const summary = tracker.getSummary();
    // 1M input * $3/1M + 100K output * $15/1M = $3 + $1.50 = $4.50
    expect(summary.estimatedCost).toBeCloseTo(4.5, 2);
  });

  test("calculates cost for haiku model", () => {
    const tracker = createUsageTracker("claude-haiku-3-5-20241022");
    tracker.record(1_000_000, 100_000);
    const summary = tracker.getSummary();
    // 1M input * $0.80/1M + 100K output * $4/1M = $0.80 + $0.40 = $1.20
    expect(summary.estimatedCost).toBeCloseTo(1.2, 2);
  });

  test("uses default pricing for unknown models", () => {
    const tracker = createUsageTracker("unknown-model");
    tracker.record(1_000_000, 100_000);
    const summary = tracker.getSummary();
    // Uses sonnet pricing as default
    expect(summary.estimatedCost).toBeCloseTo(4.5, 2);
  });
});
