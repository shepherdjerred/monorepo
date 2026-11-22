import { expect, test } from "vitest";
import {
  barScale,
  playCount,
  playPosition,
  share,
  watchTime,
  wholeNumber,
} from "./format.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LOCALE = "en-US";

test("a length of watching is said in the units a person would use", () => {
  expect(watchTime(0, LOCALE)).toBe("0 min");
  expect(watchTime(20_000, LOCALE)).toBe("Under a minute");
  expect(watchTime(29_999, LOCALE)).toBe("Under a minute");
  expect(watchTime(30_000, LOCALE)).toBe("1 min");
  expect(watchTime(45 * MINUTE, LOCALE)).toBe("45 min");
  expect(watchTime(59 * MINUTE + 29_000, LOCALE)).toBe("59 min");
  // Rounding up to the hour says the hour, not "60 min".
  expect(watchTime(59 * MINUTE + 31_000, LOCALE)).toBe("1 hr");
  expect(watchTime(HOUR, LOCALE)).toBe("1 hr");
  expect(watchTime(76 * MINUTE, LOCALE)).toBe("1 hr 16 min");
  expect(watchTime(2 * HOUR, LOCALE)).toBe("2 hr");
  expect(watchTime(99 * HOUR + 59 * MINUTE, LOCALE)).toBe("99 hr 59 min");
});

test("a household's worth of watching drops the minutes and groups the hours", () => {
  expect(watchTime(100 * HOUR, LOCALE)).toBe("100 hr");
  expect(watchTime(100 * HOUR + 29 * MINUTE, LOCALE)).toBe("100 hr");
  expect(watchTime(100 * HOUR + 31 * MINUTE, LOCALE)).toBe("101 hr");
  expect(watchTime(1474 * HOUR + 12 * MINUTE, LOCALE)).toBe("1,474 hr");
  expect(watchTime(1474 * HOUR, "de-DE")).toBe("1.474 Std.");
});

test("counts use the reader's digit grouping and agree in number", () => {
  expect(wholeNumber(0, LOCALE)).toBe("0");
  expect(wholeNumber(1449, LOCALE)).toBe("1,449");
  expect(wholeNumber(1449, "de-DE")).toBe("1.449");
  expect(playCount(0, LOCALE)).toBe("0 plays");
  expect(playCount(1, LOCALE)).toBe("1 play");
  expect(playCount(2, LOCALE)).toBe("2 plays");
  expect(playCount(1449, LOCALE)).toBe("1,449 plays");
});

test("a share is a whole percentage that never rounds a part away or up to all", () => {
  expect(share(920, 1449, LOCALE)).toBe("63%");
  expect(share(0, 10, LOCALE)).toBe("0%");
  expect(share(10, 10, LOCALE)).toBe("100%");
  expect(share(1, 1000, LOCALE)).toBe("1%");
  expect(share(999, 1000, LOCALE)).toBe("99%");
  // Nothing to be a share of.
  expect(share(0, 0, LOCALE)).toBeNull();
});

test("a stream's position fits a progress bar whatever Plex reported", () => {
  expect(playPosition(31 * MINUTE, 51 * MINUTE, LOCALE)).toEqual({
    value: 31 * MINUTE,
    max: 51 * MINUTE,
    label: "31 of 51 min",
  });
  // Past the reported end is held at the end.
  expect(playPosition(60 * MINUTE, 51 * MINUTE, LOCALE)).toEqual({
    value: 51 * MINUTE,
    max: 51 * MINUTE,
    label: "51 of 51 min",
  });
  // No reported length: a bar that can still be drawn, and no "of 0 min".
  expect(playPosition(5 * MINUTE, 0, LOCALE)).toEqual({
    value: 1,
    max: 1,
    label: "5 min",
  });
  expect(playPosition(0, 125 * MINUTE, LOCALE).label).toBe("0 of 125 min");
});

test("a ranking's bars are measured against its busiest row", () => {
  expect(barScale([138, 115, 92])).toBe(138);
  expect(barScale([92, 138])).toBe(138);
  // Nothing to measure against: the scale still divides.
  expect(barScale([])).toBe(1);
  expect(barScale([0, 0])).toBe(1);
});
