import { describe, expect, test } from "vitest";
import {
  computeClockSkewMs,
  formatRemaining,
  isClosed,
  remainingMs,
} from "./bucks-countdown.ts";

describe("bucks countdown math", () => {
  test("skew is server time minus receipt time", () => {
    expect(
      computeClockSkewMs(
        "2026-08-29T00:00:10.000Z",
        Date.parse("2026-08-29T00:00:00.000Z"),
      ),
    ).toBe(10_000);
    expect(
      computeClockSkewMs(
        "2026-08-29T00:00:00.000Z",
        Date.parse("2026-08-29T00:00:05.000Z"),
      ),
    ).toBe(-5000);
  });

  test("remaining time renders against the server clock", () => {
    const closesAt = "2026-08-29T00:10:00.000Z";
    const browserNow = Date.parse("2026-08-29T00:00:00.000Z");
    // Browser 30s behind the server: less time remains than the browser thinks.
    expect(remainingMs(closesAt, browserNow, 30_000)).toBe(9.5 * 60 * 1000);
    expect(isClosed(closesAt, browserNow, 30_000)).toBe(false);
    expect(isClosed(closesAt, browserNow, 11 * 60 * 1000)).toBe(true);
  });

  test("formats MM:SS without wrapping and clamps at zero", () => {
    expect(formatRemaining(9 * 60 * 1000 + 5000)).toBe("09:05");
    expect(formatRemaining(61 * 60 * 1000 + 1000)).toBe("61:01");
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(-1234)).toBe("00:00");
  });
});
