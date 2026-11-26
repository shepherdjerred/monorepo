/**
 * The drags that arrange a board: moving frames, resizing one, a marquee.
 * Each is a `PointerSession`: the gesture layer feeds it pointer positions in
 * the viewport; it works in world coordinates, so a camera that moves under
 * the pointer (edge auto-pan) changes the result correctly, and Esc cancels.
 */
import { screenToWorld, type WorldRect } from "#client/canvas/camera.ts";
import type { CameraController } from "#client/canvas/controller.ts";
import type { PointerSession } from "#client/canvas/gestures.ts";
import type { Point } from "#client/lib/geometry.ts";
import { createAutoPan } from "./autopan.ts";
import {
  framesInMarquee,
  marqueeSelection,
  moveRect,
  rectBetween,
  resizeRect,
  snapDelta,
  type Handle,
} from "./geometry.ts";

type Size = { readonly width: number; readonly height: number };

type DragHooks = {
  readonly controller: CameraController;
  readonly size: () => Size;
  /** Viewport-relative position where the press went down. */
  readonly start: Point;
  /** Runs on every move with the world delta from the start and whether Alt is held. */
  readonly apply: (delta: Point, alt: boolean) => void;
  readonly commit: () => void;
  readonly cancel: () => void;
};

/** The skeleton of every drag: world delta, edge auto-pan, Escape, one outcome. */
function createDrag(hooks: DragHooks): PointerSession {
  const { controller } = hooks;
  const origin = screenToWorld(controller.get(), hooks.start);
  let last = hooks.start;
  let alt = false;
  let moved = false;
  let done = false;

  function recompute(): void {
    const at = screenToWorld(controller.get(), last);
    hooks.apply({ x: at.x - origin.x, y: at.y - origin.y }, alt);
  }
  const autopan = createAutoPan(controller, hooks.size, recompute);

  function finish(cancelled: boolean): void {
    if (done) return;
    done = true;
    autopan.stop();
    globalThis.removeEventListener("keydown", onKey);
    if (cancelled || !moved) hooks.cancel();
    else hooks.commit();
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") finish(true);
  }
  globalThis.addEventListener("keydown", onKey);

  return {
    move(point, modifiers) {
      if (done) return;
      last = point;
      alt = modifiers.altKey;
      moved = true;
      recompute();
      autopan.update(point);
    },
    end: finish,
  };
}

export type MoveHooks = {
  readonly controller: CameraController;
  readonly size: () => Size;
  readonly start: Point;
  /** The id the press went down on; its corner is what snaps. */
  readonly lead: string;
  /** The frames that move, with their rectangles at the press. */
  readonly frames: ReadonlyMap<string, WorldRect>;
  /** Called once when the press turns into a drag. */
  readonly begin: () => void;
  readonly onDraft: (rects: ReadonlyMap<string, WorldRect>) => void;
  readonly onCommit: (rects: ReadonlyMap<string, WorldRect>) => void;
  readonly onCancel: () => void;
};

export function createMoveSession(hooks: MoveHooks): PointerSession {
  const leadRect = hooks.frames.get(hooks.lead);
  let began = false;
  let current: ReadonlyMap<string, WorldRect> = hooks.frames;
  return createDrag({
    controller: hooks.controller,
    size: hooks.size,
    start: hooks.start,
    apply(delta, alt) {
      if (!began) {
        began = true;
        hooks.begin();
      }
      const step =
        leadRect === undefined ? delta : snapDelta(leadRect, delta, !alt);
      current = new Map(
        [...hooks.frames].map(([id, rect]) => [id, moveRect(rect, step)]),
      );
      hooks.onDraft(current);
    },
    commit: () => {
      hooks.onCommit(current);
    },
    cancel: hooks.onCancel,
  });
}

export type ResizeHooks = {
  readonly controller: CameraController;
  readonly size: () => Size;
  readonly start: Point;
  readonly handle: Handle;
  readonly rect: WorldRect;
  /** Width over height to keep, or null to resize freely. */
  readonly aspect: number | null;
  readonly onDraft: (rect: WorldRect) => void;
  readonly onCommit: (rect: WorldRect) => void;
  readonly onCancel: () => void;
};

export function createResizeSession(hooks: ResizeHooks): PointerSession {
  let current = hooks.rect;
  return createDrag({
    controller: hooks.controller,
    size: hooks.size,
    start: hooks.start,
    apply(delta, alt) {
      current = resizeRect(hooks.rect, hooks.handle, delta, {
        aspect: hooks.aspect,
        snap: !alt,
      });
      hooks.onDraft(current);
    },
    commit: () => {
      hooks.onCommit(current);
    },
    cancel: hooks.onCancel,
  });
}

export type MarqueeHooks = {
  readonly controller: CameraController;
  readonly size: () => Size;
  readonly start: Point;
  /** The selection at the press; Shift adds to it. */
  readonly base: ReadonlySet<string>;
  readonly additive: boolean;
  readonly frames: () => readonly {
    readonly id: string;
    readonly rect: WorldRect;
  }[];
  readonly onMarquee: (rect: WorldRect | null) => void;
  readonly onSelect: (selection: ReadonlySet<string>) => void;
};

export function createMarqueeSession(hooks: MarqueeHooks): PointerSession {
  const origin = screenToWorld(hooks.controller.get(), hooks.start);
  let current = origin;
  return createDrag({
    controller: hooks.controller,
    size: hooks.size,
    start: hooks.start,
    apply(delta) {
      current = { x: origin.x + delta.x, y: origin.y + delta.y };
      const rect = rectBetween(origin, current);
      hooks.onMarquee(rect);
      hooks.onSelect(
        marqueeSelection(
          hooks.base,
          framesInMarquee(hooks.frames(), rect),
          hooks.additive,
        ),
      );
    },
    commit: () => {
      hooks.onMarquee(null);
    },
    cancel: () => {
      hooks.onMarquee(null);
      hooks.onSelect(hooks.base);
    },
  });
}
