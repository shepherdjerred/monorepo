import { describe, expect, it } from "vitest";
import { maximumTurnMicroUsd, MonthlyBudget } from "./budget.ts";

describe("GPT-6 Luna monthly budget", () => {
  it("prices the bounded request from the shared catalog", () => {
    expect(maximumTurnMicroUsd()).toBe(545);
  });

  it("reserves before spending and fails closed across restarts", async () => {
    const path = `${Bun.env["TMPDIR"] ?? "/tmp"}/storm-budget-${crypto.randomUUID()}.db`;
    const day = new Date("2026-10-01T02:00:00Z");
    const first = new MonthlyBudget(path, 1000);
    try {
      expect(first.reserve(day, "first")).toBe(true);
      expect(first.reserve(day, "second")).toBe(false);
    } finally {
      first.close();
    }
    const second = new MonthlyBudget(path, 1000);
    try {
      expect(second.reserve(day, "second")).toBe(false);
      second.settle("first", {
        inputTokens: 1000,
        outputTokens: 100,
        cacheWriteTokens: 2000,
      });
      expect(second.reserve(day, "second")).toBe(true);
      expect(() =>
        second.settle("first", { inputTokens: 1000, outputTokens: 100 }),
      ).toThrow();
      expect(() =>
        second.settle("second", {
          inputTokens: 3000,
          outputTokens: 150,
          cacheWriteTokens: 4000,
        }),
      ).toThrow("exceeded reserved");
      expect(second.reserve(day, "third")).toBe(false);
    } finally {
      second.close();
      await Bun.file(path).delete();
    }
  });
});
