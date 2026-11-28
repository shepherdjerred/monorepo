/**
 * Owns the camera. The camera lives in a plain field, never in React state:
 * input handlers write it, and one rAF loop (running only while the camera
 * moves) writes the world layer's transform once per frame and tells the
 * overlay items to follow. React hears about it once, when the camera settles.
 *
 * `will-change: transform` is set only while the camera moves. Leaving it on
 * rasterises the world once and blurs the host-DOM text; the browser re-rasters
 * when the hint is removed, which is what makes the settled canvas crisp.
 */
import { sameCamera, type Camera } from "./camera.ts";

export type MotionKind = "pan" | "zoom";

/** How long the camera must be still before it counts as settled. */
export const SETTLE_MS: Readonly<Record<MotionKind, number>> = {
  pan: 120,
  zoom: 250,
};

/** The frame timestamps kept for the adaptive preview cap. */
const MAX_FRAME_TIMES = 600;

export type SettleInfo = {
  readonly kind: MotionKind;
  /** rAF timestamps of the frames drawn during the motion that just ended. */
  readonly frameTimes: readonly number[];
};

export type Clock = {
  readonly raf: (callback: (time: number) => void) => number;
  readonly cancelRaf: (handle: number) => void;
  readonly setTimer: (callback: () => void, ms: number) => number;
  readonly clearTimer: (handle: number) => void;
};

export const browserClock: Clock = {
  raf: (callback) => requestAnimationFrame(callback),
  cancelRaf: (handle) => {
    cancelAnimationFrame(handle);
  },
  // Browsers return a number; `Number` makes that true for the types too.
  setTimer: (callback, ms) => Number(globalThis.setTimeout(callback, ms)),
  clearTimer: (handle) => {
    globalThis.clearTimeout(handle);
  },
};

/** The slice of an element the controller writes to. */
export type WorldElement = {
  readonly style: { transform: string; willChange: string };
};

export type CameraController = {
  readonly get: () => Camera;
  /** Moves the camera; the DOM follows on the next frame. */
  readonly moveTo: (camera: Camera, kind: MotionKind) => void;
  readonly attach: (world: WorldElement) => () => void;
  /** Called after every frame the camera is written, and once more on settle. */
  readonly onFrame: (listener: (camera: Camera) => void) => () => void;
  readonly onSettle: (
    listener: (camera: Camera, info: SettleInfo) => void,
  ) => () => void;
  readonly isMoving: () => boolean;
};

export function worldTransform(camera: Camera): string {
  return `translate(${String(camera.x)}px, ${String(camera.y)}px) scale(${String(camera.s)})`;
}

export function createCameraController(
  initial: Camera,
  clock: Clock = browserClock,
): CameraController {
  let camera = initial;
  let world: WorldElement | null = null;
  let moving = false;
  let dirty = true;
  let kind: MotionKind = "pan";
  let loop: number | null = null;
  let timer: number | null = null;
  let frameTimes: number[] = [];
  const frameListeners = new Set<(camera: Camera) => void>();
  const settleListeners = new Set<(camera: Camera, info: SettleInfo) => void>();

  function write(): void {
    if (world !== null && dirty) world.style.transform = worldTransform(camera);
    dirty = false;
    for (const listener of frameListeners) listener(camera);
  }

  function tick(time: number): void {
    loop = null;
    if (!moving) return;
    frameTimes.push(time);
    if (frameTimes.length > MAX_FRAME_TIMES)
      frameTimes = frameTimes.slice(-MAX_FRAME_TIMES);
    if (dirty) write();
    loop = clock.raf(tick);
  }

  function settle(): void {
    timer = null;
    moving = false;
    if (loop !== null) {
      clock.cancelRaf(loop);
      loop = null;
    }
    if (world !== null) world.style.willChange = "auto";
    write();
    const info: SettleInfo = { kind, frameTimes };
    frameTimes = [];
    for (const listener of settleListeners) listener(camera, info);
  }

  return {
    get: () => camera,
    moveTo(next, motion) {
      if (!sameCamera(next, camera)) {
        camera = next;
        dirty = true;
      }
      kind = motion;
      if (!moving) {
        moving = true;
        if (world !== null) world.style.willChange = "transform";
        loop = clock.raf(tick);
      }
      if (timer !== null) clock.clearTimer(timer);
      timer = clock.setTimer(settle, SETTLE_MS[motion]);
    },
    attach(element) {
      world = element;
      world.style.transform = worldTransform(camera);
      world.style.willChange = moving ? "transform" : "auto";
      dirty = false;
      return () => {
        if (world === element) world = null;
        if (timer !== null) clock.clearTimer(timer);
        if (loop !== null) clock.cancelRaf(loop);
        timer = null;
        loop = null;
        moving = false;
      };
    },
    onFrame(listener) {
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    },
    onSettle(listener) {
      settleListeners.add(listener);
      return () => {
        settleListeners.delete(listener);
      };
    },
    isMoving: () => moving,
  };
}
