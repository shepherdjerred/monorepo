/**
 * Two-finger zoom arrives three ways: two pointers (touch, iPad), Safari's
 * `gesturestart/change/end` (macOS trackpad, iPad), and `gesture` messages a
 * live frame forwards over the bridge. Safari can deliver pointers and
 * gesture events for the same pinch, so one arbiter owns it: whichever source
 * starts first drives the camera; a gesture may take over from pointers, never
 * the other way, and the pointers stay muted until they are lifted.
 */
import type { Point } from "#client/lib/geometry.ts";
import { pinchTo, type Camera } from "./camera.ts";

export type PinchSource = "pointer" | "gesture";

type Session = {
  readonly source: PinchSource;
  readonly camera: Camera;
  readonly centre: Point;
  readonly distance: number;
};

export type Pinch = {
  readonly owner: () => PinchSource | null;
  readonly startPointers: (camera: Camera, a: Point, b: Point) => void;
  readonly movePointers: (a: Point, b: Point) => Camera | null;
  /** All pointers of the pinch are up. */
  readonly endPointers: () => void;
  readonly startGesture: (camera: Camera, centre: Point) => void;
  readonly moveGesture: (scale: number, centre: Point) => Camera | null;
  readonly endGesture: () => void;
};

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function createPinch(): Pinch {
  let session: Session | null = null;

  return {
    owner: () => session?.source ?? null,
    startPointers(camera, a, b) {
      // A gesture that already owns the pinch keeps it.
      if (session?.source === "gesture") return;
      session = {
        source: "pointer",
        camera,
        centre: midpoint(a, b),
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      };
    },
    movePointers(a, b) {
      if (session?.source !== "pointer") return null;
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      return pinchTo(
        session.camera,
        session.centre,
        midpoint(a, b),
        distance / session.distance,
      );
    },
    endPointers() {
      if (session?.source === "pointer") session = null;
    },
    startGesture(camera, centre) {
      session = { source: "gesture", camera, centre, distance: 1 };
    },
    moveGesture(scale, centre) {
      return session?.source === "gesture"
        ? pinchTo(session.camera, session.centre, centre, scale)
        : null;
    },
    endGesture() {
      // Pointers still down stay muted: `movePointers` answers null without a
      // pointer session, and `startPointers` runs again only for a new pinch.
      if (session?.source === "gesture") session = null;
    },
  };
}

/** A gesture session ends this long after the last forwarded message. */
export const FORWARDED_GESTURE_IDLE_MS = 200;

/**
 * Gesture messages from a live frame carry only a cumulative `scale`, no
 * start or end. A message after an idle gap starts a new session at the
 * camera it finds, so the result is a function of (start camera, scale,
 * centre) and replaying a message never compounds.
 */
export type ForwardedGestures = {
  readonly feed: (
    message: { readonly scale: number; readonly centre: Point },
    camera: Camera,
    now: number,
  ) => Camera;
};

export function createForwardedGestures(): ForwardedGestures {
  let session: { camera: Camera; centre: Point } | null = null;
  let last = Number.NEGATIVE_INFINITY;
  return {
    feed({ scale, centre }, camera, now) {
      if (session === null || now - last > FORWARDED_GESTURE_IDLE_MS)
        session = { camera, centre };
      last = now;
      return pinchTo(session.camera, session.centre, centre, scale);
    },
  };
}
