/**
 * Camera math for the board canvas. The world layer is drawn with
 * `translate(x, y) scale(s)` and origin 0 0, so `screen = camera + s * world`
 * where `screen` is relative to the viewport's top-left corner. Every function
 * is pure; the DOM glue lives in `controller.ts` and `gestures.ts`.
 */
import { z } from "zod";
import { clamp, type Point } from "#client/lib/geometry.ts";

export type Camera = {
  readonly x: number;
  readonly y: number;
  readonly s: number;
};
export type Size = { readonly width: number; readonly height: number };
/** A rectangle in world pixels, the same shape as a board index frame. */
export type WorldRect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 4;
export const HOME_CAMERA: Camera = { x: 0, y: 0, s: 1 };

/** One wheel line in CSS pixels, and one page when the browser reports pages. */
const LINE_PX = 16;
const PAGE_PX = 800;
/** Larger wheel deltas (a mouse wheel notch with a modifier) zoom no faster than this. */
const MAX_ZOOM_DELTA = 30;
const ZOOM_SENSITIVITY = 0.01;

export function clampScale(scale: number): number {
  return clamp(scale, MIN_SCALE, MAX_SCALE);
}

export function worldToScreen(camera: Camera, world: Point): Point {
  return { x: camera.x + camera.s * world.x, y: camera.y + camera.s * world.y };
}

export function screenToWorld(camera: Camera, screen: Point): Point {
  return {
    x: (screen.x - camera.x) / camera.s,
    y: (screen.y - camera.y) / camera.s,
  };
}

/** Scales by `factor` around a viewport point: the world under `at` stays under it. */
export function zoomAt(camera: Camera, at: Point, factor: number): Camera {
  return zoomToScale(camera, at, camera.s * factor);
}

export function zoomToScale(camera: Camera, at: Point, scale: number): Camera {
  const s = clampScale(scale);
  const ratio = s / camera.s;
  return {
    s,
    x: at.x - (at.x - camera.x) * ratio,
    y: at.y - (at.y - camera.y) * ratio,
  };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

/**
 * A pinch or gesture: the world point under the start centre ends under the
 * current centre, and the scale is the start scale times `ratio`. It is always
 * computed from the camera at the start, so repeating it never compounds.
 */
export function pinchTo(
  start: Camera,
  startCentre: Point,
  centre: Point,
  ratio: number,
): Camera {
  const s = clampScale(start.s * ratio);
  const world = screenToWorld(start, startCentre);
  return { s, x: centre.x - world.x * s, y: centre.y - world.y * s };
}

/** The world rectangle a viewport of `size` shows. */
export function visibleRect(camera: Camera, size: Size): WorldRect {
  return {
    x: -camera.x / camera.s,
    y: -camera.y / camera.s,
    w: size.width / camera.s,
    h: size.height / camera.s,
  };
}

export function boundsOf(rects: readonly WorldRect[]): WorldRect | null {
  const [first, ...rest] = rects;
  if (first === undefined) return null;
  let left = first.x;
  let top = first.y;
  let right = first.x + first.w;
  let bottom = first.y + first.h;
  for (const rect of rest) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.w);
    bottom = Math.max(bottom, rect.y + rect.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function intersects(a: WorldRect, b: WorldRect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

export function expandRect(rect: WorldRect, fraction: number): WorldRect {
  const dx = rect.w * fraction;
  const dy = rect.h * fraction;
  return {
    x: rect.x - dx,
    y: rect.y - dy,
    w: rect.w + 2 * dx,
    h: rect.h + 2 * dy,
  };
}

export function centreOf(rect: WorldRect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** The camera that shows `rect` centred in `size`, with `padding` screen pixels around it. */
export function fitRect(
  rect: WorldRect,
  size: Size,
  options: { readonly padding?: number; readonly maxScale?: number } = {},
): Camera {
  const { padding = 48, maxScale = 1 } = options;
  const availableWidth = Math.max(1, size.width - 2 * padding);
  const availableHeight = Math.max(1, size.height - 2 * padding);
  const s = clamp(
    Math.min(
      availableWidth / Math.max(1, rect.w),
      availableHeight / Math.max(1, rect.h),
    ),
    MIN_SCALE,
    Math.min(maxScale, MAX_SCALE),
  );
  const centre = centreOf(rect);
  return {
    s,
    x: size.width / 2 - centre.x * s,
    y: size.height / 2 - centre.y * s,
  };
}

/** The camera at 100 %, keeping the world point under the viewport centre. */
export function resetZoom(camera: Camera, size: Size): Camera {
  return zoomToScale(camera, { x: size.width / 2, y: size.height / 2 }, 1);
}

export function sameCamera(a: Camera, b: Camera, epsilon = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.s - b.s) < epsilon
  );
}

/** What a wheel event moves, in CSS pixels whatever unit the browser reports. */
export function normalizeWheel(event: {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly shiftKey?: boolean;
}): { readonly dx: number; readonly dy: number } {
  const unit =
    event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? PAGE_PX : 1;
  const dx = event.deltaX * unit;
  const dy = event.deltaY * unit;
  // A mouse wheel with Shift held scrolls sideways; some engines leave it on Y.
  return dx === 0 && event.shiftKey === true ? { dx: dy, dy: 0 } : { dx, dy };
}

/** The scale factor of one wheel event with Ctrl or Meta held (a pinch or a zoom wheel). */
export function wheelZoomFactor(dy: number): number {
  return Math.exp(
    -clamp(dy, -MAX_ZOOM_DELTA, MAX_ZOOM_DELTA) * ZOOM_SENSITIVITY,
  );
}

const StoredCameraSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  s: z.number().min(MIN_SCALE).max(MAX_SCALE),
});

/** A camera read back from storage, or null when there is none or it is not one. */
export function parseStoredCamera(raw: string | null): Camera | null {
  if (raw === null) return null;
  try {
    const parsed = StoredCameraSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function serializeCamera(camera: Camera): string {
  return JSON.stringify({ x: camera.x, y: camera.y, s: camera.s });
}
