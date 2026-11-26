import { describe, expect, test } from "vitest";
import {
  boundsOf,
  clampScale,
  fitRect,
  HOME_CAMERA,
  intersects,
  MAX_SCALE,
  MIN_SCALE,
  normalizeWheel,
  panBy,
  parseStoredCamera,
  pinchTo,
  resetZoom,
  screenToWorld,
  serializeCamera,
  visibleRect,
  wheelZoomFactor,
  worldToScreen,
  zoomAt,
  type Camera,
} from "./camera.ts";

const camera: Camera = { x: -137.3, y: 55.9, s: 0.37 };

describe("screen and world", () => {
  test("a round trip returns the point", () => {
    const point = { x: 812.5, y: 301.25 };
    const back = worldToScreen(camera, screenToWorld(camera, point));
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
  });

  test("the visible rect is the inverse of the viewport", () => {
    const rect = visibleRect(
      { x: -200, y: -100, s: 2 },
      { width: 800, height: 600 },
    );
    expect(rect).toEqual({ x: 100, y: 50, w: 400, h: 300 });
  });
});

describe("zoom at the cursor", () => {
  test("the world point under the cursor does not move, over many steps", () => {
    const at = { x: 700, y: 400 };
    const world = screenToWorld(camera, at);
    let current = camera;
    const deltas = [-30, 12, -7, 30, 30, -30, -30, -30, 5, 1, -1];
    for (const delta of deltas) {
      current = zoomAt(current, at, wheelZoomFactor(delta));
      const screen = worldToScreen(current, world);
      expect(Math.abs(screen.x - at.x)).toBeLessThan(1e-6);
      expect(Math.abs(screen.y - at.y)).toBeLessThan(1e-6);
    }
  });

  test("a moving cursor keeps the world point under it at every step", () => {
    let current = camera;
    for (let step = 0; step < 40; step += 1) {
      const at = { x: 50 + step * 17, y: 700 - step * 11 };
      const world = screenToWorld(current, at);
      current = zoomAt(current, at, wheelZoomFactor(step % 2 === 0 ? 9 : -14));
      const screen = worldToScreen(current, world);
      expect(Math.abs(screen.x - at.x)).toBeLessThan(1e-6);
      expect(Math.abs(screen.y - at.y)).toBeLessThan(1e-6);
    }
  });

  test("the scale is clamped at both ends and the point still holds", () => {
    const at = { x: 321, y: 123 };
    const world = screenToWorld(camera, at);
    let zoomedIn = camera;
    for (let step = 0; step < 100; step += 1)
      zoomedIn = zoomAt(zoomedIn, at, 1.5);
    expect(zoomedIn.s).toBe(MAX_SCALE);
    let zoomedOut = camera;
    for (let step = 0; step < 100; step += 1)
      zoomedOut = zoomAt(zoomedOut, at, 0.5);
    expect(zoomedOut.s).toBe(MIN_SCALE);
    for (const clamped of [zoomedIn, zoomedOut]) {
      const screen = worldToScreen(clamped, world);
      expect(Math.abs(screen.x - at.x)).toBeLessThan(1e-6);
      expect(Math.abs(screen.y - at.y)).toBeLessThan(1e-6);
    }
  });

  test("clampScale bounds any number", () => {
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(1)).toBe(1);
  });
});

describe("wheel", () => {
  test("normalises lines and pages to pixels", () => {
    expect(normalizeWheel({ deltaX: 1, deltaY: 2, deltaMode: 1 })).toEqual({
      dx: 16,
      dy: 32,
    });
    expect(normalizeWheel({ deltaX: 0, deltaY: 1, deltaMode: 2 })).toEqual({
      dx: 0,
      dy: 800,
    });
    expect(normalizeWheel({ deltaX: 3, deltaY: 4, deltaMode: 0 })).toEqual({
      dx: 3,
      dy: 4,
    });
  });

  test("shift turns a vertical wheel sideways", () => {
    expect(
      normalizeWheel({ deltaX: 0, deltaY: 40, deltaMode: 0, shiftKey: true }),
    ).toEqual({ dx: 40, dy: 0 });
  });

  test("zoom factor is symmetric and capped per event", () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(10) * wheelZoomFactor(-10)).toBeCloseTo(1, 12);
    expect(wheelZoomFactor(5000)).toBe(wheelZoomFactor(30));
    expect(wheelZoomFactor(-5000)).toBe(wheelZoomFactor(-30));
  });

  test("panning moves the camera by exactly the delta", () => {
    expect(panBy(camera, -37, 21)).toEqual({
      ...camera,
      x: camera.x - 37,
      y: camera.y + 21,
    });
  });
});

describe("pinch", () => {
  const start: Camera = { x: 80, y: 30, s: 0.6 };
  const c0 = { x: 600, y: 400 };

  test("the world under the start centre ends under the current centre", () => {
    const world = screenToWorld(start, c0);
    const centre = { x: 660, y: 360 };
    const next = pinchTo(start, c0, centre, 1.5);
    expect(next.s).toBeCloseTo(0.9, 12);
    const screen = worldToScreen(next, world);
    expect(screen.x).toBeCloseTo(centre.x, 9);
    expect(screen.y).toBeCloseTo(centre.y, 9);
  });

  test("is idempotent: the same input always gives the same camera", () => {
    const once = pinchTo(start, c0, { x: 610, y: 390 }, 1.2);
    const again = pinchTo(start, c0, { x: 610, y: 390 }, 1.2);
    expect(again).toEqual(once);
  });

  test("the ratio is clamped by the scale limits", () => {
    expect(pinchTo(start, c0, c0, 1000).s).toBe(MAX_SCALE);
    expect(pinchTo(start, c0, c0, 0.0001).s).toBe(MIN_SCALE);
  });
});

describe("fitting", () => {
  const viewport = { width: 1000, height: 700 };

  test("fit-all centres the bounds and does not zoom past 100 %", () => {
    const small = { x: 0, y: 0, w: 200, h: 100 };
    const fitted = fitRect(small, viewport);
    expect(fitted.s).toBe(1);
    expect(worldToScreen(fitted, { x: 100, y: 50 })).toEqual({
      x: 500,
      y: 350,
    });
  });

  test("fit-all shrinks to the padded viewport", () => {
    const wide = { x: -500, y: 0, w: 4000, h: 1000 };
    const fitted = fitRect(wide, viewport, { padding: 50 });
    expect(fitted.s).toBeCloseTo(900 / 4000, 12);
    const left = worldToScreen(fitted, { x: wide.x, y: 0 });
    const right = worldToScreen(fitted, { x: wide.x + wide.w, y: 0 });
    expect(left.x).toBeCloseTo(50, 9);
    expect(right.x).toBeCloseTo(950, 9);
  });

  test("fit-selection may zoom in", () => {
    const fitted = fitRect({ x: 0, y: 0, w: 300, h: 200 }, viewport, {
      maxScale: 2,
    });
    expect(fitted.s).toBe(2);
  });

  test("100 % keeps the world point under the viewport centre", () => {
    const before: Camera = { x: -300, y: -200, s: 0.4 };
    const centre = { x: 500, y: 350 };
    const world = screenToWorld(before, centre);
    const after = resetZoom(before, viewport);
    expect(after.s).toBe(1);
    const screen = worldToScreen(after, world);
    expect(screen.x).toBeCloseTo(centre.x, 9);
    expect(screen.y).toBeCloseTo(centre.y, 9);
  });

  test("bounds of nothing is null, of several is their union", () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: -5, w: 10, h: 10 },
      ]),
    ).toEqual({ x: 0, y: -5, w: 30, h: 15 });
  });

  test("rectangles intersect only when they overlap", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(intersects(a, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
    expect(intersects(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });
});

describe("storage", () => {
  test("round-trips a camera", () => {
    expect(parseStoredCamera(serializeCamera(camera))).toEqual(camera);
  });

  test("rejects anything that is not a camera", () => {
    expect(parseStoredCamera(null)).toBeNull();
    expect(parseStoredCamera("not json")).toBeNull();
    expect(parseStoredCamera(JSON.stringify({ x: 1, y: 2 }))).toBeNull();
    expect(parseStoredCamera(JSON.stringify({ x: 1, y: 2, s: 99 }))).toBeNull();
    expect(
      parseStoredCamera(JSON.stringify({ x: 1, y: 2, s: 1, extra: true })),
    ).toBeNull();
  });

  test("the home camera is the identity", () => {
    expect(screenToWorld(HOME_CAMERA, { x: 5, y: 6 })).toEqual({ x: 5, y: 6 });
  });
});
