import { describe, expect, test } from "bun:test";

import { elapsedSecondsSince, formatElapsed } from "./elapsed";

describe("formatElapsed", () => {
  test("under a minute → 00:SS", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(7)).toBe("00:07");
    expect(formatElapsed(45)).toBe("00:45");
  });

  test("under an hour → MM:SS", () => {
    expect(formatElapsed(60)).toBe("01:00");
    expect(formatElapsed(605)).toBe("10:05");
    expect(formatElapsed(3599)).toBe("59:59");
  });

  test("hour or more → H:MM:SS", () => {
    expect(formatElapsed(3600)).toBe("1:00:00");
    expect(formatElapsed(3725)).toBe("1:02:05");
    expect(formatElapsed(36_000)).toBe("10:00:00");
  });

  test("clamps negative input to zero", () => {
    expect(formatElapsed(-5)).toBe("00:00");
  });

  test("floors fractional seconds", () => {
    expect(formatElapsed(45.9)).toBe("00:45");
  });
});

describe("elapsedSecondsSince", () => {
  test("computes elapsed seconds against a fixed now", () => {
    const start = "2026-05-10T12:00:00.000Z";
    const now = new Date("2026-05-10T12:00:30.500Z").getTime();
    expect(elapsedSecondsSince(start, now)).toBe(30);
  });

  test("returns 0 for invalid date string", () => {
    expect(elapsedSecondsSince("not a date", Date.now())).toBe(0);
  });

  test("returns 0 if start is after now (clamps)", () => {
    const start = "2026-05-10T12:00:30.000Z";
    const now = new Date("2026-05-10T12:00:00.000Z").getTime();
    expect(elapsedSecondsSince(start, now)).toBe(0);
  });
});
