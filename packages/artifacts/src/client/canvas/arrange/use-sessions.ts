import { useCallback, useRef } from "react";
import type { CameraController } from "#client/canvas/controller.ts";
import type { PointerSession, SessionStart } from "#client/canvas/gestures.ts";
import { fixedAspect, type CanvasFrameModel } from "#client/canvas/model.ts";
import type { WorldRect } from "#client/canvas/camera.ts";
import type { Point } from "#client/lib/geometry.ts";
import type { Handle } from "./geometry.ts";
import {
  createMarqueeSession,
  createMoveSession,
  createResizeSession,
} from "./sessions.ts";
import type { Arrange } from "./use-arrange.ts";

type Size = { readonly width: number; readonly height: number };

/**
 * Builds the pointer sessions of arranging: a press on a frame moves it (and
 * the rest of the selection), a press on empty canvas draws a marquee, a
 * press on a handle resizes. Each reads the latest frames and selection
 * through refs, so the gesture layer's long-lived listeners never go stale.
 */
export function useArrangeSessions({
  controller,
  size,
  arrange,
  frames,
  blocked,
  setMarquee,
}: {
  readonly controller: CameraController;
  readonly size: () => Size;
  readonly arrange: Arrange;
  readonly frames: readonly CanvasFrameModel[];
  /** Comment mode and the live frame own the pointer; nothing is arranged then. */
  readonly blocked: (frameId: string | null) => boolean;
  readonly setMarquee: (rect: WorldRect | null) => void;
}): {
  readonly beginSession: (start: SessionStart) => PointerSession | null;
  readonly startResize: (
    frameId: string,
    handle: Handle,
    point: Point,
  ) => PointerSession | null;
} {
  const latest = useRef({ arrange, frames, blocked });
  latest.current = { arrange, frames, blocked };

  const beginSession = useCallback(
    (start: SessionStart): PointerSession | null => {
      const {
        arrange: current,
        frames: all,
        blocked: isBlocked,
      } = latest.current;
      if (isBlocked(start.frameId)) return null;
      const { frameId } = start;
      if (frameId === null)
        return createMarqueeSession({
          controller,
          size,
          start: start.point,
          base: start.shiftKey ? current.selection : new Set(),
          additive: start.shiftKey,
          frames: () => latest.current.frames,
          onMarquee: setMarquee,
          onSelect: current.setSelection,
        });
      const moving = current.selection.has(frameId)
        ? [...current.selection]
        : [frameId];
      const rects = new Map(
        all.flatMap((frame) =>
          moving.includes(frame.id) ? [[frame.id, frame.rect] as const] : [],
        ),
      );
      return createMoveSession({
        controller,
        size,
        start: start.point,
        lead: frameId,
        frames: rects,
        begin: () => {
          const now = latest.current.arrange;
          if (!now.selection.has(frameId))
            now.setSelection(
              start.shiftKey
                ? new Set([...now.selection, frameId])
                : new Set([frameId]),
            );
        },
        onDraft: (draft) => {
          latest.current.arrange.setDraft(draft);
        },
        onCommit: (draft) => {
          latest.current.arrange.commitRects("Move", draft);
        },
        onCancel: () => {
          latest.current.arrange.setDraft(null);
        },
      });
    },
    [controller, size, setMarquee],
  );

  const startResize = useCallback(
    (frameId: string, handle: Handle, point: Point): PointerSession | null => {
      const frame = latest.current.frames.find((entry) => entry.id === frameId);
      if (frame === undefined) return null;
      return createResizeSession({
        controller,
        size,
        start: point,
        handle,
        rect: frame.rect,
        aspect: fixedAspect(frame.summary),
        onDraft: (rect) => {
          latest.current.arrange.setDraft(new Map([[frameId, rect]]));
        },
        onCommit: (rect) => {
          latest.current.arrange.commitRects(
            "Resize",
            new Map([[frameId, rect]]),
          );
        },
        onCancel: () => {
          latest.current.arrange.setDraft(null);
        },
      });
    },
    [controller, size],
  );

  return { beginSession, startResize };
}
