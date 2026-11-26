import { useCallback, useRef } from "react";
import type { WorldRect } from "#client/canvas/camera.ts";
import type { CameraController } from "#client/canvas/controller.ts";
import {
  type PointerSession,
  type SessionStart,
  type Tool,
} from "#client/canvas/gestures.ts";
import { fixedAspect, type CanvasFrameModel } from "#client/canvas/model.ts";
import type { Note, NoteModel } from "#client/canvas/notes/shapes.ts";
import type { Point } from "#client/lib/geometry.ts";
import type { Handle } from "./geometry.ts";
import {
  createDrawSession,
  createEndpointSession,
  createMarqueeSession,
  createMoveSession,
  createResizeSession,
} from "./sessions.ts";
import type { Arrange } from "./use-arrange.ts";

type Size = { readonly width: number; readonly height: number };

type Inputs = {
  readonly controller: CameraController;
  readonly size: () => Size;
  readonly arrange: Arrange;
  readonly frames: readonly CanvasFrameModel[];
  readonly notes: readonly NoteModel[];
  readonly tool: Tool;
  /** The colour new annotations are drawn in. */
  readonly color: string;
  /** Comment mode and the live frame own the pointer; nothing is arranged then. */
  readonly blocked: (targetId: string | null) => boolean;
  readonly shift: () => boolean;
  readonly setMarquee: (rect: WorldRect | null) => void;
  /** The annotation being drawn right now, or null. */
  readonly setPreview: (note: Note | null) => void;
  readonly onCreate: (note: Note) => void;
};

/**
 * Builds the pointer sessions of the canvas: a press on a frame or annotation
 * moves it (and the rest of the selection), a press on empty canvas draws a
 * marquee, a press with a drawing tool draws, a press on a handle resizes or
 * moves an endpoint. Each reads the latest state through a ref, so the gesture
 * layer's long-lived listeners never go stale.
 */
export function useArrangeSessions(inputs: Inputs): {
  readonly beginSession: (start: SessionStart) => PointerSession | null;
  readonly startResize: (
    id: string,
    handle: Handle,
    point: Point,
  ) => PointerSession | null;
  readonly startEndpoint: (
    id: string,
    end: "start" | "end",
    point: Point,
  ) => PointerSession | null;
} {
  const latest = useRef(inputs);
  latest.current = inputs;
  const { controller, size } = inputs;

  const beginSession = useCallback(
    (start: SessionStart): PointerSession | null => {
      const now = latest.current;
      if (now.blocked(start.targetId)) return null;
      const { tool } = now;
      if (tool !== "select" && tool !== "hand") {
        // A click makes a text or a default sticky (the tap handler); only a drag draws.
        if (tool === "text") return null;
        return createDrawSession({
          controller,
          size,
          start: start.point,
          tool,
          color: now.color,
          constrain: () => latest.current.shift(),
          onPreview: (note) => {
            latest.current.setPreview(note);
          },
          onCreate: (note) => {
            latest.current.onCreate(note);
          },
        });
      }
      const { targetId } = start;
      if (targetId === null)
        return createMarqueeSession({
          controller,
          size,
          start: start.point,
          base: start.shiftKey ? now.arrange.selection : new Set(),
          additive: start.shiftKey,
          frames: () => [...latest.current.frames, ...latest.current.notes],
          onMarquee: now.setMarquee,
          onSelect: now.arrange.setSelection,
        });
      const moving = now.arrange.selection.has(targetId)
        ? [...now.arrange.selection]
        : [targetId];
      const rects = new Map(
        [...now.frames, ...now.notes].flatMap((item) =>
          moving.includes(item.id) ? [[item.id, item.rect] as const] : [],
        ),
      );
      return createMoveSession({
        controller,
        size,
        start: start.point,
        lead: targetId,
        frames: rects,
        begin: () => {
          const current = latest.current.arrange;
          if (!current.selection.has(targetId))
            current.setSelection(
              start.shiftKey
                ? new Set([...current.selection, targetId])
                : new Set([targetId]),
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
    [controller, size],
  );

  const startResize = useCallback(
    (id: string, handle: Handle, point: Point): PointerSession | null => {
      const now = latest.current;
      const frame = now.frames.find((entry) => entry.id === id);
      const note = now.notes.find((entry) => entry.id === id);
      const target = frame ?? note;
      if (target === undefined) return null;
      return createResizeSession({
        controller,
        size,
        start: point,
        handle,
        rect: target.rect,
        aspect: frame === undefined ? null : fixedAspect(frame.summary),
        onDraft: (rect) => {
          latest.current.arrange.setDraft(new Map([[id, rect]]));
        },
        onCommit: (rect) => {
          latest.current.arrange.commitRects("Resize", new Map([[id, rect]]));
        },
        onCancel: () => {
          latest.current.arrange.setDraft(null);
        },
      });
    },
    [controller, size],
  );

  const startEndpoint = useCallback(
    (id: string, end: "start" | "end", point: Point): PointerSession | null => {
      const model = latest.current.notes.find((entry) => entry.id === id);
      const note = model?.note;
      if (note?.type !== "line" && note?.type !== "arrow") return null;
      return createEndpointSession({
        controller,
        size,
        start: point,
        note,
        end,
        constrain: () => latest.current.shift(),
        onDraft: (draft) => {
          latest.current.arrange.setNoteDraft(new Map([[id, draft]]));
        },
        onCommit: (draft) => {
          latest.current.arrange.putNote("Move endpoint", id, draft);
        },
        onCancel: () => {
          latest.current.arrange.setNoteDraft(null);
        },
      });
    },
    [controller, size],
  );

  return { beginSession, startResize, startEndpoint };
}
