/**
 * Turns pointer, wheel and Safari gesture events on the canvas viewport into
 * camera moves. It owns no React state: it writes the camera through the
 * controller and reports taps, which are the only thing the page decides.
 *
 * - Wheel: Ctrl or Meta zooms at the cursor (a trackpad pinch arrives as a
 *   Ctrl wheel), anything else pans. Non-passive, so the page never scrolls.
 * - Pointers: one pointer pans after a 4 px threshold (and at once with the
 *   hand tool, Space, or the middle button); two pointers pinch.
 * - Safari `gesture*` events are idempotent with the pointer pinch through the
 *   pinch arbiter.
 * - A drag takes pointer capture and raises the pan blanket, so a frame under
 *   the pointer cannot swallow the move events.
 */
import { z } from "zod";
import {
  normalizeWheel,
  panBy,
  wheelZoomFactor,
  zoomAt,
  type Camera,
} from "./camera.ts";
import type { CameraController } from "./controller.ts";
import type { Point } from "#client/lib/geometry.ts";
import { createPinch } from "./pinch.ts";

export type Tool = "select" | "hand";

export type Tap = {
  /** The frame under the pointer when it went down, or null on empty canvas. */
  readonly frameId: string | null;
  /** Viewport-relative. */
  readonly point: Point;
  readonly shiftKey: boolean;
};

/**
 * A drag the page runs once a press has moved past the threshold: moving
 * frames, a marquee. The gesture layer feeds it pointer positions and ends it.
 */
export type PointerSession = {
  readonly move: (
    point: Point,
    modifiers: { readonly altKey: boolean },
  ) => void;
  readonly end: (cancelled: boolean) => void;
};

export type SessionStart = {
  /** The frame under the pointer when it went down, or null on empty canvas. */
  readonly frameId: string | null;
  /** Viewport-relative. */
  readonly point: Point;
  readonly shiftKey: boolean;
};

export type GestureDeps = {
  readonly viewport: HTMLElement;
  readonly blanket: HTMLElement;
  readonly controller: CameraController;
  readonly tool: () => Tool;
  readonly spaceHeld: () => boolean;
  readonly onTap: (tap: Tap) => void;
  readonly onDoubleTap: (frameId: string) => void;
  /**
   * A mouse press with the select tool; the session it returns takes over
   * from panning once the pointer moves 4 px. Null pans (or taps) instead.
   */
  readonly beginSession?: (start: SessionStart) => PointerSession | null;
};

/** A pointer must move this far before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_DISTANCE_PX = 12;

type Tracked = {
  session?: PointerSession | null;
  point: Point;
  readonly down: Point;
  readonly frameId: string | null;
  readonly type: string;
  readonly shiftKey: boolean;
};

type Pan = { readonly camera: Camera; readonly from: Point };

/** Safari's gesture events carry a cumulative `scale` and the gesture's centre. */
const GestureSchema = z.object({
  scale: z.number(),
  clientX: z.number(),
  clientY: z.number(),
});

function frameOf(target: EventTarget | null): string | null {
  const element = target instanceof Element ? target : null;
  return (
    element?.closest<HTMLElement>("[data-frame-id]")?.dataset["frameId"] ?? null
  );
}

function inIgnored(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest("[data-cv-ignore]") !== null
  );
}

export function attachGestures(deps: GestureDeps): () => void {
  const { viewport, blanket, controller } = deps;
  const pointers = new Map<number, Tracked>();
  const pinch = createPinch();
  let pan: Pan | null = null;
  let session: PointerSession | null = null;
  let dragged = false;
  let lastTap: { frameId: string; at: number; point: Point } | null = null;

  function relative(event: { clientX: number; clientY: number }): Point {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function showBlanket(on: boolean): void {
    blanket.hidden = !on;
  }

  function capture(id: number): void {
    try {
      viewport.setPointerCapture(id);
    } catch {
      // A synthetic or already-released pointer cannot be captured.
    }
  }

  function beginPan(from: Point): void {
    pan = { camera: controller.get(), from };
    dragged = true;
    showBlanket(true);
  }

  function pair(): [Point, Point] | null {
    const [a, b] = [...pointers.values()];
    return a === undefined || b === undefined ? null : [a.point, b.point];
  }

  /** A mouse press with the select tool may become the page's own drag. */
  function startSession(event: PointerEvent, point: Point): void {
    const tracked = pointers.get(event.pointerId);
    const wanted =
      event.pointerType === "mouse" &&
      event.button === 0 &&
      deps.tool() === "select" &&
      !deps.spaceHeld();
    if (tracked === undefined || !wanted) return;
    tracked.session =
      deps.beginSession?.({
        frameId: tracked.frameId,
        point,
        shiftKey: event.shiftKey,
      }) ?? null;
  }

  function onPointerDown(event: PointerEvent): void {
    if (inIgnored(event.target)) return;
    if (event.pointerType === "mouse" && event.button > 1) return;
    if (event.button === 1) event.preventDefault();
    const point = relative(event);
    pointers.set(event.pointerId, {
      point,
      down: point,
      frameId: frameOf(event.target),
      type: event.pointerType,
      shiftKey: event.shiftKey,
    });
    if (pointers.size === 1) {
      dragged = false;
      startSession(event, point);
      const immediate =
        event.button === 1 ||
        (event.pointerType === "mouse" &&
          (deps.tool() === "hand" || deps.spaceHeld()));
      if (immediate) {
        capture(event.pointerId);
        beginPan(point);
      }
      return;
    }
    const both = pair();
    if (both !== null && pointers.size === 2) {
      // The second finger turns the drag into a pinch.
      for (const id of pointers.keys()) capture(id);
      pan = null;
      dragged = true;
      showBlanket(true);
      pinch.startPointers(controller.get(), both[0], both[1]);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    const tracked = pointers.get(event.pointerId);
    if (tracked === undefined) return;
    tracked.point = relative(event);
    if (pointers.size >= 2) {
      const both = pair();
      const next = both === null ? null : pinch.movePointers(both[0], both[1]);
      if (next !== null) controller.moveTo(next, "zoom");
      return;
    }
    if (session !== null) {
      session.move(tracked.point, { altKey: event.altKey });
      return;
    }
    if (pan === null) {
      const moved = Math.hypot(
        tracked.point.x - tracked.down.x,
        tracked.point.y - tracked.down.y,
      );
      if (moved < DRAG_THRESHOLD_PX) return;
      capture(event.pointerId);
      if (tracked.session !== undefined && tracked.session !== null) {
        // The page's drag (move frames, marquee) takes over from panning.
        session = tracked.session;
        dragged = true;
        showBlanket(true);
        session.move(tracked.point, { altKey: event.altKey });
        return;
      }
      beginPan(tracked.down);
    }
    if (pan === null) return;
    controller.moveTo(
      panBy(
        pan.camera,
        tracked.point.x - pan.from.x,
        tracked.point.y - pan.from.y,
      ),
      "pan",
    );
  }

  function endPointer(event: PointerEvent): void {
    const tracked = pointers.get(event.pointerId);
    if (tracked === undefined) return;
    pointers.delete(event.pointerId);
    if (viewport.hasPointerCapture(event.pointerId))
      viewport.releasePointerCapture(event.pointerId);
    if (pointers.size === 1) {
      // One finger of a pinch is still down: it keeps panning from here.
      pinch.endPointers();
      const [rest] = [...pointers.values()];
      if (rest !== undefined) beginPan(rest.point);
      return;
    }
    if (pointers.size > 0) return;
    pinch.endPointers();
    showBlanket(false);
    const wasDrag = dragged;
    const cancelled = event.type === "pointercancel";
    // A press that never moved still owns a session that must clean up.
    (session ?? tracked.session)?.end(cancelled || !wasDrag);
    session = null;
    pan = null;
    dragged = false;
    if (wasDrag || cancelled) return;
    tap(tracked, event.type === "pointerup");
  }

  function tap(tracked: Tracked, real: boolean): void {
    if (!real) return;
    const now = performance.now();
    deps.onTap({
      frameId: tracked.frameId,
      point: tracked.point,
      shiftKey: tracked.shiftKey,
    });
    if (tracked.frameId === null || tracked.type === "mouse") {
      // A mouse reports double clicks itself (`dblclick`); touch and pen need counting.
      if (tracked.type !== "mouse") lastTap = null;
      return;
    }
    const previous = lastTap;
    if (
      previous?.frameId === tracked.frameId &&
      now - previous.at < DOUBLE_TAP_MS &&
      Math.hypot(
        previous.point.x - tracked.point.x,
        previous.point.y - tracked.point.y,
      ) < DOUBLE_TAP_DISTANCE_PX
    ) {
      lastTap = null;
      deps.onDoubleTap(tracked.frameId);
      return;
    }
    lastTap = { frameId: tracked.frameId, at: now, point: tracked.point };
  }

  function onDoubleClick(event: MouseEvent): void {
    if (inIgnored(event.target)) return;
    const frameId = frameOf(event.target);
    if (frameId !== null) deps.onDoubleTap(frameId);
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const camera = controller.get();
    if (event.ctrlKey || event.metaKey) {
      const { dy } = normalizeWheel(event);
      controller.moveTo(
        zoomAt(camera, relative(event), wheelZoomFactor(dy)),
        "zoom",
      );
      return;
    }
    const { dx, dy } = normalizeWheel(event);
    controller.moveTo(panBy(camera, -dx, -dy), "pan");
  }

  function onGestureStart(event: Event): void {
    event.preventDefault();
    const gesture = GestureSchema.safeParse(event);
    if (!gesture.success) return;
    pinch.startGesture(controller.get(), relative(gesture.data));
    showBlanket(true);
  }

  function onGestureChange(event: Event): void {
    event.preventDefault();
    const gesture = GestureSchema.safeParse(event);
    if (!gesture.success) return;
    const next = pinch.moveGesture(gesture.data.scale, relative(gesture.data));
    if (next !== null) controller.moveTo(next, "zoom");
  }

  function onGestureEnd(event: Event): void {
    event.preventDefault();
    pinch.endGesture();
    if (pointers.size === 0) showBlanket(false);
  }

  function onContextMenu(event: Event): void {
    // A middle or secondary press that panned must not open a menu on release.
    if (dragged) event.preventDefault();
  }

  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerup", endPointer);
  viewport.addEventListener("pointercancel", endPointer);
  viewport.addEventListener("dblclick", onDoubleClick);
  viewport.addEventListener("contextmenu", onContextMenu);
  for (const [name, handler] of [
    ["gesturestart", onGestureStart],
    ["gesturechange", onGestureChange],
    ["gestureend", onGestureEnd],
  ] as const)
    viewport.addEventListener(name, handler, { passive: false });

  return () => {
    viewport.removeEventListener("wheel", onWheel);
    viewport.removeEventListener("pointerdown", onPointerDown);
    viewport.removeEventListener("pointermove", onPointerMove);
    viewport.removeEventListener("pointerup", endPointer);
    viewport.removeEventListener("pointercancel", endPointer);
    viewport.removeEventListener("dblclick", onDoubleClick);
    viewport.removeEventListener("contextmenu", onContextMenu);
    for (const [name, handler] of [
      ["gesturestart", onGestureStart],
      ["gesturechange", onGestureChange],
      ["gestureend", onGestureEnd],
    ] as const)
      viewport.removeEventListener(name, handler);
    showBlanket(false);
  };
}
