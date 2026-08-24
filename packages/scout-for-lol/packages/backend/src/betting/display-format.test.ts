import { describe, expect, test } from "vitest";
import {
  formatDurationSeconds,
  formatInteger,
  formatParlayNumericValue,
} from "#src/betting/display-format.ts";

describe("Bryan Bucks display formatting", () => {
  test.each([
    [0, "0"],
    [3000, "3,000"],
    [-1_234_567, "-1,234,567"],
  ])("groups integer %i", (value, expected) => {
    expect(formatInteger(value)).toBe(expected);
  });

  test.each([
    [0, "00:00"],
    [7, "00:07"],
    [9 * 60 + 5, "09:05"],
    [60 * 60 + 2, "60:02"],
  ])("formats %i seconds without wrapping minutes", (value, expected) => {
    expect(formatDurationSeconds(value)).toBe(expected);
  });

  test("formats current and legacy duration fields", () => {
    for (const field of [
      "gameDuration",
      "longestTimeSpentLiving",
      "timeCCingOthers",
      "timePlayed",
      "totalTimeCCDealt",
      "totalTimeSpentDead",
    ]) {
      expect(formatParlayNumericValue(field, 3661)).toBe("61:01");
    }
    expect(formatParlayNumericValue("goldEarned", 12_345)).toBe("12,345");
  });
});
