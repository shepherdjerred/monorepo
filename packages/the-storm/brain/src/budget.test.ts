import { describe, expect, it } from "vitest";
import { maximumTurnMicroUsd, MonthlyBudget } from "./budget.ts";

describe("GPT-6 Luna monthly budget", () => {
  it("prices the bounded request from the shared catalog", () => {
    expect(maximumTurnMicroUsd()).toBe(275);
  });

  it("reserves before spending and fails closed across restarts", async () => {
    const path = `${Bun.env["TMPDIR"] ?? "/tmp"}/storm-budget-${crypto.randomUUID()}.db`;
    const day = new Date("2026-10-01T02:00:00Z");
    const first = new MonthlyBudget(path, 500);
    try {
      expect(first.reserve(day, "first")).toBe(true);
      expect(first.reserve(day, "second")).toBe(false);
    } finally {
      first.close();
    }
    const second = new MonthlyBudget(path, 500);
    try {
      expect(second.reserve(day, "second")).toBe(false);
      second.settle("first", 1000, 100);
      expect(second.reserve(day, "second")).toBe(true);
      expect(() => second.settle("first", 1000, 100)).toThrow();
      expect(() => second.settle("second", 3000, 150)).toThrow(
        "exceeded reserved",
      );
      expect(second.reserve(day, "third")).toBe(false);
    } finally {
      second.close();
      await Bun.file(path).delete();
    }
  });
});
