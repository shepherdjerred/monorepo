import { describe, expect, test } from "bun:test";

import {
  ALL_PRIORITIES,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  comparePriority,
} from "./priority";
import type { Priority } from "./priority";

describe("PRIORITY_LABELS", () => {
  test("has correct labels", () => {
    expect(PRIORITY_LABELS.highest).toBe("P1");
    expect(PRIORITY_LABELS.high).toBe("P2");
    expect(PRIORITY_LABELS.medium).toBe("P3");
    expect(PRIORITY_LABELS.normal).toBe("Normal");
    expect(PRIORITY_LABELS.low).toBe("P4");
    expect(PRIORITY_LABELS.none).toBe("None");
  });

  test("has exactly 6 entries", () => {
    expect(Object.keys(PRIORITY_LABELS)).toHaveLength(6);
  });
});

describe("PRIORITY_ORDER", () => {
  test("highest has lowest order number (most important first)", () => {
    expect(PRIORITY_ORDER.highest).toBe(0);
  });

  test("none has highest order number (least important last)", () => {
    expect(PRIORITY_ORDER.none).toBe(5);
  });

  test("order is strictly increasing", () => {
    expect(PRIORITY_ORDER.highest).toBeLessThan(PRIORITY_ORDER.high);
    expect(PRIORITY_ORDER.high).toBeLessThan(PRIORITY_ORDER.medium);
    expect(PRIORITY_ORDER.medium).toBeLessThan(PRIORITY_ORDER.normal);
    expect(PRIORITY_ORDER.normal).toBeLessThan(PRIORITY_ORDER.low);
    expect(PRIORITY_ORDER.low).toBeLessThan(PRIORITY_ORDER.none);
  });
});

describe("PRIORITY_COLORS", () => {
  test("has a color for every priority", () => {
    for (const p of ALL_PRIORITIES) {
      expect(PRIORITY_COLORS[p]).toBeDefined();
      expect(PRIORITY_COLORS[p]).toMatch(/^#[\da-f]{6}$/i);
    }
  });
});

describe("ALL_PRIORITIES", () => {
  test("contains all 6 priority levels", () => {
    expect(ALL_PRIORITIES).toHaveLength(6);
  });

  test("is ordered from highest to none", () => {
    expect(ALL_PRIORITIES).toEqual([
      "highest",
      "high",
      "medium",
      "normal",
      "low",
      "none",
    ]);
  });
});

describe("comparePriority", () => {
  test("returns negative when first is higher priority", () => {
    expect(comparePriority("highest", "low")).toBeLessThan(0);
  });

  test("returns positive when first is lower priority", () => {
    expect(comparePriority("low", "highest")).toBeGreaterThan(0);
  });

  test("returns 0 for same priority", () => {
    const priorities: Priority[] = [
      "highest",
      "high",
      "medium",
      "normal",
      "low",
      "none",
    ];
    for (const p of priorities) {
      expect(comparePriority(p, p)).toBe(0);
    }
  });

  test("highest < high < medium < normal < low < none", () => {
    expect(comparePriority("highest", "high")).toBeLessThan(0);
    expect(comparePriority("high", "medium")).toBeLessThan(0);
    expect(comparePriority("medium", "normal")).toBeLessThan(0);
    expect(comparePriority("normal", "low")).toBeLessThan(0);
    expect(comparePriority("low", "none")).toBeLessThan(0);
  });

  test("can be used to sort an array", () => {
    const unsorted: Priority[] = ["low", "highest", "normal", "high"];
    const sorted = unsorted.toSorted(comparePriority);
    expect(sorted).toEqual(["highest", "high", "normal", "low"]);
  });
});
