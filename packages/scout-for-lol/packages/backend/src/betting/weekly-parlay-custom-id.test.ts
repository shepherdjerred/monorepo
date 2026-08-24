import { describe, expect, test } from "vitest";
import {
  formatWeeklyParlayCustomId,
  isWeeklyParlayCustomId,
  parseWeeklyParlayCustomId,
} from "#src/betting/weekly-parlay-custom-id.ts";

describe("weekly parlay custom IDs", () => {
  test("round trips the compact versioned format", () => {
    const input = {
      action: "b" as const,
      marketId: 42,
      side: "NO" as const,
      amount: 25,
    };
    expect(
      parseWeeklyParlayCustomId(formatWeeklyParlayCustomId(input)),
    ).toEqual(input);
  });

  test("claims malformed namespaced IDs without parsing them", () => {
    expect(isWeeklyParlayCustomId("bbw:old")).toBe(true);
    expect(parseWeeklyParlayCustomId("bbw:old")).toBeUndefined();
  });
});
