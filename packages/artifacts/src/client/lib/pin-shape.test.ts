import { describe, expect, test } from "vitest";
import {
  PIN_HEIGHT,
  PIN_PATH,
  PIN_TIP,
  PIN_WIDTH,
  pinAnchor,
  pinOrigin,
} from "./pin-shape.ts";

describe("the speech-bubble pin", () => {
  test("its tail tip maps to the anchor it was placed at, and back", () => {
    for (const anchor of [
      { x: 0, y: 0 },
      { x: 312.4, y: 87.9 },
      { x: -50, y: 1200 },
    ]) {
      const origin = pinOrigin(anchor);
      const tip = pinAnchor(origin);
      expect(Math.abs(tip.x - anchor.x)).toBeLessThan(1e-9);
      expect(Math.abs(tip.y - anchor.y)).toBeLessThan(1e-9);
      // The tip is inside the box, on its bottom edge.
      expect(origin.x + PIN_TIP.x).toBeCloseTo(anchor.x, 9);
      expect(origin.y + PIN_HEIGHT).toBeCloseTo(anchor.y, 9);
    }
  });

  test("the outline really ends its tail at the tip, inside the box", () => {
    expect(PIN_PATH.split("L")).toContain(
      `${String(PIN_TIP.x)} ${String(PIN_TIP.y)}`,
    );
    expect(PIN_TIP.x).toBeLessThanOrEqual(PIN_WIDTH);
    expect(PIN_TIP.y).toBe(PIN_HEIGHT);
  });

  test("keeps a 24 px hit target", () => {
    expect(PIN_WIDTH).toBeGreaterThanOrEqual(24);
    expect(PIN_HEIGHT).toBeGreaterThanOrEqual(24);
  });
});
