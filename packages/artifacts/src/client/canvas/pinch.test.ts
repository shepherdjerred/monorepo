import { describe, expect, test } from "vitest";
import { screenToWorld, worldToScreen, type Camera } from "./camera.ts";
import { createForwardedGestures, createPinch } from "./pinch.ts";

const start: Camera = { x: 80, y: 30, s: 0.6 };

describe("pointer pinch", () => {
  test("two pointers moving apart scale by the distance ratio around the centre", () => {
    const pinch = createPinch();
    pinch.startPointers(start, { x: 500, y: 400 }, { x: 700, y: 400 });
    const world = screenToWorld(start, { x: 600, y: 400 });
    // The fingers spread to 300 px apart and drift up 20 px.
    const next = pinch.movePointers({ x: 450, y: 380 }, { x: 750, y: 380 });
    expect(next?.s).toBeCloseTo(0.9, 12);
    const screen = worldToScreen(next ?? start, world);
    expect(screen.x).toBeCloseTo(600, 9);
    expect(screen.y).toBeCloseTo(380, 9);
  });

  test("repeating the same pointer positions never compounds", () => {
    const pinch = createPinch();
    pinch.startPointers(start, { x: 500, y: 400 }, { x: 700, y: 400 });
    const first = pinch.movePointers({ x: 450, y: 400 }, { x: 750, y: 400 });
    const second = pinch.movePointers({ x: 450, y: 400 }, { x: 750, y: 400 });
    expect(second).toEqual(first);
  });
});

describe("safari gestures", () => {
  test("scale is relative to the camera at gesturestart", () => {
    const pinch = createPinch();
    pinch.startGesture(start, { x: 600, y: 400 });
    expect(pinch.moveGesture(1.1, { x: 600, y: 400 })?.s).toBeCloseTo(0.66, 12);
    expect(pinch.moveGesture(1.5, { x: 600, y: 400 })?.s).toBeCloseTo(0.9, 12);
  });

  test("gesture events without a start are ignored", () => {
    expect(createPinch().moveGesture(2, { x: 0, y: 0 })).toBeNull();
  });
});

describe("pointers and gestures for the same pinch", () => {
  test("the ratio is applied once, not twice", () => {
    const pinch = createPinch();
    const a = { x: 500, y: 400 };
    const b = { x: 700, y: 400 };
    pinch.startPointers(start, a, b);
    // Safari reports the gesture right after the second pointer lands.
    pinch.startGesture(start, { x: 600, y: 400 });
    let camera = start;
    for (let step = 1; step <= 10; step += 1) {
      const spread = (step / 10) * 50;
      // Pointers keep moving and the gesture reports the same pinch.
      const fromPointers = pinch.movePointers(
        { x: a.x - spread, y: a.y },
        { x: b.x + spread, y: b.y },
      );
      expect(fromPointers).toBeNull();
      camera =
        pinch.moveGesture(1 + 0.5 * (step / 10), { x: 600, y: 400 }) ?? camera;
    }
    pinch.endGesture();
    pinch.endPointers();
    expect(camera.s / start.s).toBeCloseTo(1.5, 12);
  });

  test("pointers stay muted after the gesture ends until a new pinch starts", () => {
    const pinch = createPinch();
    pinch.startPointers(start, { x: 500, y: 400 }, { x: 700, y: 400 });
    pinch.startGesture(start, { x: 600, y: 400 });
    pinch.endGesture();
    expect(
      pinch.movePointers({ x: 400, y: 400 }, { x: 800, y: 400 }),
    ).toBeNull();
    expect(pinch.owner()).toBeNull();
  });

  test("a gesture that is already running keeps the pinch when pointers arrive", () => {
    const pinch = createPinch();
    pinch.startGesture(start, { x: 600, y: 400 });
    pinch.startPointers(start, { x: 500, y: 400 }, { x: 700, y: 400 });
    expect(pinch.owner()).toBe("gesture");
    expect(pinch.movePointers({ x: 0, y: 0 }, { x: 900, y: 0 })).toBeNull();
  });
});

describe("forwarded gestures", () => {
  test("a burst is one session anchored at its first message", () => {
    const forwarded = createForwardedGestures();
    const at = { x: 400, y: 300 };
    let camera = start;
    camera = forwarded.feed({ scale: 1, centre: at }, camera, 0);
    camera = forwarded.feed({ scale: 1.2, centre: at }, camera, 16);
    camera = forwarded.feed({ scale: 1.5, centre: at }, camera, 32);
    expect(camera.s / start.s).toBeCloseTo(1.5, 12);
    // Replaying the last message changes nothing.
    const again = forwarded.feed({ scale: 1.5, centre: at }, camera, 40);
    expect(again).toEqual(camera);
  });

  test("a message after a pause starts a new session at the current camera", () => {
    const forwarded = createForwardedGestures();
    const at = { x: 400, y: 300 };
    let camera = forwarded.feed({ scale: 1.5, centre: at }, start, 0);
    const settled = camera;
    camera = forwarded.feed({ scale: 1.1, centre: at }, camera, 1000);
    expect(camera.s / settled.s).toBeCloseTo(1.1, 12);
  });
});
