import { __iconData } from "lucide-react/icons/message-circle";
import { describe, expect, test } from "vitest";
import {
  commentCursor,
  CURSOR_HOTSPOT,
  CURSOR_SIZE,
  ICON_PATH,
  ICON_TIP,
  PIN_HEIGHT,
  PIN_SIZE,
  PIN_TIP,
  PIN_WIDTH,
  pinAnchor,
  pinOrigin,
} from "./pin-shape.ts";

/** lucide's `message-circle` at the version this tail tip was measured on. */
const MEASURED_PATH =
  "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719";

describe("the comment glyph", () => {
  test("is lucide's own MessageCircle path, and the tail tip was measured on it", () => {
    expect(ICON_PATH).toBe(__iconData.node[0]?.[1].d);
    // If lucide redraws the icon, the tail tip below must be measured again.
    expect(ICON_PATH).toBe(MEASURED_PATH);
  });

  test("the tail tip sits on the glyph's tail corner, at the bottom-left of its box", () => {
    expect(ICON_TIP.x).toBeLessThan(3);
    expect(ICON_TIP.y).toBeGreaterThan(21);
    // On the radius-1 corner arc between (2.021, 20.799) and (3.257, 21.967):
    // its centre is (3.001, 21.0), and the tip is one radius from it.
    expect(Math.hypot(ICON_TIP.x - 3.001, ICON_TIP.y - 21)).toBeCloseTo(1, 2);
  });
});

describe("the comment pin", () => {
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
      expect(origin.x + PIN_TIP.x).toBeCloseTo(anchor.x, 9);
      expect(origin.y + PIN_TIP.y).toBeCloseTo(anchor.y, 9);
    }
  });

  test("the tip is inside the box, near its bottom-left, and the target is at least 24 px", () => {
    expect(PIN_TIP.x).toBeGreaterThan(0);
    expect(PIN_TIP.x).toBeLessThan(PIN_WIDTH / 4);
    expect(PIN_TIP.y).toBeGreaterThan((PIN_HEIGHT * 3) / 4);
    expect(PIN_TIP.y).toBeLessThanOrEqual(PIN_HEIGHT);
    expect(PIN_SIZE).toBeGreaterThanOrEqual(24);
  });
});

describe("the comment cursor", () => {
  const cursor = commentCursor("#176b4d");

  test("is the glyph's path, drawn twice (halo and body), with a crosshair fallback", () => {
    expect(cursor.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(cursor.endsWith(", crosshair")).toBe(true);
    expect(cursor.split(ICON_PATH).length - 1).toBe(2);
    expect(cursor).toContain("%23176b4d");
    expect(cursor).toContain("fill='%23fff'");
  });

  test("the hotspot is the tail tip within half a pixel", () => {
    expect(CURSOR_HOTSPOT.x).toBeGreaterThan(0);
    expect(Math.abs(CURSOR_HOTSPOT.x - (ICON_TIP.x + 3))).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(CURSOR_HOTSPOT.y - (ICON_TIP.y + 3))).toBeLessThanOrEqual(
      0.5,
    );
    expect(cursor).toContain(
      `") ${String(CURSOR_HOTSPOT.x)} ${String(CURSOR_HOTSPOT.y)}, crosshair`,
    );
    expect(CURSOR_HOTSPOT.x).toBeLessThan(CURSOR_SIZE);
    expect(CURSOR_HOTSPOT.y).toBeLessThan(CURSOR_SIZE);
  });
});
