import { describe, expect, it } from "vitest";
import { formatRaceTime, ordinal, percent, relativeTime } from "./format.ts";

describe("formatRaceTime", () => {
  it("formats minutes, seconds and hundredths", () => {
    expect(formatRaceTime(83_450)).toBe("1:23.45");
    expect(formatRaceTime(5070)).toBe("0:05.07");
    expect(formatRaceTime(0)).toBe("0:00.00");
  });
});

describe("ordinal", () => {
  it("suffixes the MK64 placements", () => {
    expect([1, 2, 3, 4, 8].map((n) => ordinal(n))).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "8th",
    ]);
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(22)).toBe("22nd");
  });
});

describe("relativeTime", () => {
  const now = 1_800_000_000_000;
  it("buckets recent times", () => {
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

describe("percent", () => {
  it("rounds to whole percent", () => {
    expect(percent(0.456)).toBe("46%");
  });
});
