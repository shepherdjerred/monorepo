import { beforeEach, describe, expect, test } from "vitest";
import {
  DESKTOP_READ_LIMIT_PER_MINUTE,
  desktopReadAllowed,
  resetDesktopReadRateLimitForTests,
} from "./rate-limit.ts";

const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const DEVICE = "4fa2a856-53af-42a4-85af-5cc085a942a3";
const OTHER_DEVICE = "0f4d6c1e-8a51-4c62-9a1e-3b7f2d9c5e10";

describe("desktop read limiter", () => {
  beforeEach(() => resetDesktopReadRateLimitForTests(NOW));

  test("limits each device credential on its own", () => {
    for (let call = 0; call < DESKTOP_READ_LIMIT_PER_MINUTE; call += 1) {
      expect(desktopReadAllowed(DEVICE, NOW)).toBe(true);
    }
    expect(desktopReadAllowed(DEVICE, NOW)).toBe(false);
    expect(desktopReadAllowed(OTHER_DEVICE, NOW)).toBe(true);
  });

  test("resets the fixed window after one minute", () => {
    for (let call = 0; call <= DESKTOP_READ_LIMIT_PER_MINUTE; call += 1) {
      desktopReadAllowed(DEVICE, NOW);
    }
    expect(desktopReadAllowed(DEVICE, NOW + 59_999)).toBe(false);
    expect(desktopReadAllowed(DEVICE, NOW + 60_000)).toBe(true);
  });
});
