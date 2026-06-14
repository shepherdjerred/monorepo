import { describe, expect, test } from "bun:test";
import type { CompletedGoal } from "./goal-history.ts";
import { formatHistoryForPrompt } from "./history-summary.ts";

function entry(overrides: Partial<CompletedGoal> = {}): CompletedGoal {
  return {
    id: "id",
    goal: "Reach Petalburg",
    requestedBy: "user-a",
    startedAt: "2026-06-13T00:00:00.000Z",
    finishedAt: "2026-06-13T00:05:00.000Z",
    status: "completed",
    ...overrides,
  };
}

describe("formatHistoryForPrompt", () => {
  test("empty history renders an explicit no-goals line", () => {
    expect(formatHistoryForPrompt([])).toBe(
      "No completed goals yet this session.",
    );
  });

  test("renders each entry with status, goal, timestamps, and report", () => {
    const out = formatHistoryForPrompt([
      entry({ goal: "Buy potions", finalReport: "Bought 5 potions." }),
    ]);
    expect(out).toContain("[1] (completed) Buy potions");
    expect(out).toContain("started 2026-06-13T00:00:00.000Z");
    expect(out).toContain("finished 2026-06-13T00:05:00.000Z");
    expect(out).toContain("report: Bought 5 potions.");
  });

  test("missing report renders an explicit placeholder", () => {
    const out = formatHistoryForPrompt([entry({ finalReport: undefined })]);
    expect(out).toContain("(no final report)");
  });

  test("truncates long reports to a single-line snippet", () => {
    const long = "x".repeat(1000);
    const out = formatHistoryForPrompt([entry({ finalReport: long })]);
    // 280-char cap + ellipsis.
    expect(out).toContain(`report: ${"x".repeat(280)}…`);
  });

  test("collapses whitespace in the report to keep the prompt tight", () => {
    const out = formatHistoryForPrompt([
      entry({ finalReport: "line one\n\nline two\n  indented" }),
    ]);
    expect(out).toContain("report: line one line two indented");
  });

  test("numbers entries 1-based and respects the input ordering", () => {
    const out = formatHistoryForPrompt([
      entry({ goal: "First", finalReport: "a" }),
      entry({ goal: "Second", finalReport: "b" }),
    ]);
    expect(out.indexOf("[1] (completed) First")).toBeLessThan(
      out.indexOf("[2] (completed) Second"),
    );
  });

  test("surfaces non-completed statuses faithfully", () => {
    const out = formatHistoryForPrompt([
      entry({ status: "timeout", goal: "Beat E4" }),
    ]);
    expect(out).toContain("[1] (timeout) Beat E4");
  });
});
