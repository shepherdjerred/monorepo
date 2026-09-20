import { describe, expect, test } from "vitest";
import {
  clashScheduleSightingWindow,
  formatClashThemeLabel,
  isClashPlayerPollWindow,
  toClashEpochMs,
} from "./theme.ts";

describe("formatClashThemeLabel", () => {
  test("title-cases Riot name keys", () => {
    expect(formatClashThemeLabel("freljord", "day_1")).toBe("Freljord · Day 1");
  });
});

describe("isClashPlayerPollWindow", () => {
  const start = 1_779_100_000_000;
  const registration = start - 3 * 24 * 60 * 60 * 1000;

  test("opens within a week of start and stays through the weekend", () => {
    expect(
      isClashPlayerPollWindow(
        [
          {
            registrationTime: registration,
            startTime: start,
            cancelled: false,
          },
        ],
        start - 2 * 24 * 60 * 60 * 1000,
      ),
    ).toBe(true);
    expect(
      isClashPlayerPollWindow(
        [
          {
            registrationTime: registration,
            startTime: start,
            cancelled: false,
          },
        ],
        start + 60 * 60 * 1000,
      ),
    ).toBe(true);
  });

  test("skips cancelled and far-future phases", () => {
    expect(
      isClashPlayerPollWindow(
        [{ registrationTime: registration, startTime: start, cancelled: true }],
        start,
      ),
    ).toBe(false);
    expect(
      isClashPlayerPollWindow(
        [
          {
            registrationTime: start + 30 * 24 * 60 * 60 * 1000,
            startTime: start + 32 * 24 * 60 * 60 * 1000,
            cancelled: false,
          },
        ],
        start,
      ),
    ).toBe(false);
  });
});

describe("clashScheduleSightingWindow", () => {
  test("spans registration through a week after start", () => {
    const start = 1_779_100_000_000;
    const registration = start - 3 * 24 * 60 * 60 * 1000;
    const window = clashScheduleSightingWindow([
      {
        registrationTime: registration,
        startTime: start,
        cancelled: false,
      },
    ]);
    expect(window).toEqual({
      startMs: registration,
      endMs: start + 7 * 24 * 60 * 60 * 1000,
    });
  });
});

describe("toClashEpochMs", () => {
  test("promotes second-scale timestamps", () => {
    expect(toClashEpochMs(1_779_100_000)).toBe(1_779_100_000_000);
    expect(toClashEpochMs(1_779_100_000_000)).toBe(1_779_100_000_000);
  });
});
