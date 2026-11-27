import { panBy } from "#client/canvas/camera.ts";
import type { CameraController } from "#client/canvas/controller.ts";
import type { Point } from "#client/lib/geometry.ts";

/** The camera pans when a dragged pointer is this close to the viewport's edge. */
export const EDGE_PX = 48;
/** The most it pans per frame, in screen pixels. */
export const MAX_PAN_PX = 18;

/** Pan per frame along one axis for a pointer `value` px from the start of a `length` px axis. */
function axisVelocity(value: number, length: number): number {
  if (value < EDGE_PX)
    return Math.min(1, (EDGE_PX - value) / EDGE_PX) * MAX_PAN_PX;
  return value > length - EDGE_PX
    ? -Math.min(1, (value - (length - EDGE_PX)) / EDGE_PX) * MAX_PAN_PX
    : 0;
}

/** How far, and which way, the camera pans for a pointer at `point` in a viewport of `size`. */
export function edgeVelocity(
  point: Point,
  size: { readonly width: number; readonly height: number },
): Point {
  return {
    x: axisVelocity(point.x, size.width),
    y: axisVelocity(point.y, size.height),
  };
}

export type AutoPan = {
  /** Tells it where the pointer is (viewport-relative); null stops it. */
  readonly update: (point: Point | null) => void;
  readonly stop: () => void;
};

/**
 * Pans the camera while a drag is held near an edge, once per animation frame,
 * and calls `onTick` after each pan so the drag can recompute from the new camera.
 */
export function createAutoPan(
  controller: CameraController,
  size: () => { readonly width: number; readonly height: number },
  onTick: () => void,
): AutoPan {
  let point: Point | null = null;
  let handle: number | null = null;

  function tick(): void {
    handle = null;
    if (point === null) return;
    const velocity = edgeVelocity(point, size());
    if (velocity.x !== 0 || velocity.y !== 0) {
      controller.moveTo(panBy(controller.get(), velocity.x, velocity.y), "pan");
      onTick();
    }
    handle = requestAnimationFrame(tick);
  }

  return {
    update(next) {
      point = next;
      if (next !== null && handle === null)
        handle = requestAnimationFrame(tick);
    },
    stop() {
      point = null;
      if (handle !== null) cancelAnimationFrame(handle);
      handle = null;
    },
  };
}
