import { useCallback, useMemo, useRef, useState } from "react";
import {
  BoardIndexSchema,
  type BoardIndex,
  type BoardOp,
} from "@shepherdjerred/artifacts/contract";
import { applyBoardOps } from "#domain/board-ops.ts";
import type { BoardData } from "#client/data/api.ts";
import {
  applyDraft,
  frameModels,
  type CanvasFrameModel,
} from "#client/canvas/model.ts";
import type { WorldRect } from "#client/canvas/camera.ts";
import { createHistory } from "./history.ts";
import { NUDGE, NUDGE_FAST, stepOrder, type OrderStep } from "./geometry.ts";
import { entryBetween, entryOps } from "./ops.ts";
import { useBoardLayout, type SaveStatus } from "./use-layout.ts";

export type Arrange = {
  /** The frames to draw: server index, edits not yet saved, and any drag in progress. */
  readonly frames: readonly CanvasFrameModel[];
  readonly selection: ReadonlySet<string>;
  readonly setSelection: (selection: ReadonlySet<string>) => void;
  /** Live positions of the frames being dragged or resized, or null. */
  readonly setDraft: (draft: ReadonlyMap<string, WorldRect> | null) => void;
  /** Saves a finished drag or resize as one undo step. */
  readonly commitRects: (
    label: string,
    rects: ReadonlyMap<string, WorldRect>,
  ) => void;
  readonly nudge: (dx: number, dy: number, fast: boolean) => void;
  readonly order: (step: OrderStep) => void;
  readonly remove: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: () => boolean;
  readonly canRedo: () => boolean;
  readonly status: SaveStatus;
  /** The ids this actor's own ops touched since the last call (so they are not announced as new). */
  readonly takeOwn: () => ReadonlySet<string>;
  /** The latest thing done, for a polite live region. */
  readonly announcement: string;
};

function touchedBy(ops: readonly BoardOp[]): string[] {
  return ops.flatMap((op) => {
    switch (op.op) {
      case "moveFrames":
        return op.moves.map((move) => move.artifactId);
      case "removeFrame":
      case "placeFrame":
        return [op.artifactId];
      case "reorder":
      case "putNote":
      case "deleteNote":
      case "setLaunch":
        return [];
    }
  });
}

function titleOf(data: Pick<BoardData, "artifacts">, id: string): string {
  return (
    data.artifacts.find((artifact) => artifact.id === id)?.title ?? "frame"
  );
}

/**
 * Selection, drag drafts, history and the commands that edit the arrangement
 * (nudge, z-order, delete, undo, redo) over `useBoardLayout`. Every command is
 * an op applied locally and saved; undo and redo replay a history entry as ops
 * against what the board looks like now.
 */
export function useArrange(
  slug: string,
  data: Pick<BoardData, "index" | "artifacts">,
): Arrange {
  // The wire type only differs in optionality; parsing makes it the contract's.
  const base = useMemo(() => BoardIndexSchema.parse(data.index), [data.index]);
  const layout = useBoardLayout(slug, base);
  const history = useRef(createHistory());
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState<ReadonlyMap<string, WorldRect> | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState("");
  const own = useRef(new Set<string>());
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const artifacts = useRef(data.artifacts);
  artifacts.current = data.artifacts;

  const frames = useMemo(
    () =>
      applyDraft(
        frameModels({ index: layout.index, artifacts: data.artifacts }),
        draft,
      ),
    [layout.index, data.artifacts, draft],
  );

  const edit = useCallback(
    (
      label: string,
      ops: readonly BoardOp[],
      key?: string,
    ): BoardIndex | null => {
      const before = layout.latest();
      const after = applyBoardOps(before, [...ops]);
      const entry = entryBetween({
        label,
        before,
        after,
        touched: touchedBy(ops),
        at: Date.now(),
        ...(key === undefined ? {} : { key }),
      });
      if (entry === null) return null;
      history.current.push(entry);
      for (const id of touchedBy(ops)) own.current.add(id);
      layout.apply(ops);
      return after;
    },
    [layout],
  );

  const commitRects = useCallback(
    (label: string, rects: ReadonlyMap<string, WorldRect>) => {
      const index = layout.latest();
      const moves = [...rects].flatMap(([id, rect]) => {
        const frame = index.frames[id];
        if (frame === undefined) return [];
        const resized = frame.w !== rect.w || frame.h !== rect.h;
        return [
          {
            artifactId: id,
            x: rect.x,
            y: rect.y,
            ...(resized ? { w: rect.w, h: rect.h } : {}),
          },
        ];
      });
      const done =
        moves.length === 0 ? null : edit(label, [{ op: "moveFrames", moves }]);
      setDraft(null);
      const [first] = moves;
      if (done !== null && first !== undefined) {
        const frame = done.frames[first.artifactId];
        const what =
          moves.length === 1
            ? titleOf({ artifacts: artifacts.current }, first.artifactId)
            : `${String(moves.length)} frames`;
        setAnnouncement(
          `${label === "Resize" ? "Resized" : "Moved"} ${what}${frame === undefined ? "" : ` to ${String(Math.round(frame.x))}, ${String(Math.round(frame.y))}`}`,
        );
      }
    },
    [edit, layout],
  );

  const nudge = useCallback(
    (dx: number, dy: number, fast: boolean) => {
      const step = fast ? NUDGE_FAST : NUDGE;
      const index = layout.latest();
      const moves = [...selectionRef.current].flatMap((id) => {
        const frame = index.frames[id];
        return frame === undefined
          ? []
          : [
              {
                artifactId: id,
                x: frame.x + dx * step,
                y: frame.y + dy * step,
              },
            ];
      });
      if (moves.length === 0) return;
      edit("Nudge", [{ op: "moveFrames", moves }], "nudge");
      const [first] = moves;
      if (first !== undefined)
        setAnnouncement(
          `Moved ${moves.length === 1 ? titleOf({ artifacts: artifacts.current }, first.artifactId) : `${String(moves.length)} frames`} to ${String(first.x)}, ${String(first.y)}`,
        );
    },
    [edit, layout],
  );

  const order = useCallback(
    (step: OrderStep) => {
      const index = layout.latest();
      const next = stepOrder(index.order, selectionRef.current, step);
      const done = edit("Order", [{ op: "reorder", order: next }]);
      if (done !== null)
        setAnnouncement(
          `Moved ${step === "front" ? "to the front" : step === "back" ? "to the back" : step === "forward" ? "forward" : "backward"}`,
        );
    },
    [edit, layout],
  );

  const remove = useCallback(() => {
    const ids = [...selectionRef.current].filter(
      (id) => id in layout.latest().frames,
    );
    if (ids.length === 0) return;
    edit(
      "Delete from board",
      ids.map((id) => ({ op: "removeFrame", artifactId: id })),
    );
    setSelection(new Set());
    setAnnouncement(
      `Removed ${ids.length === 1 ? titleOf({ artifacts: artifacts.current }, ids[0] ?? "") : `${String(ids.length)} frames`} from the board`,
    );
  }, [edit, layout]);

  const replay = useCallback(
    (direction: "undo" | "redo") => {
      const entry =
        direction === "undo" ? history.current.undo() : history.current.redo();
      if (entry === null) return;
      const ops = entryOps(entry, direction, layout.latest());
      for (const id of entry.frames.keys()) own.current.add(id);
      layout.apply(ops);
      setSelection(
        new Set(
          [...entry.frames.keys()].filter(
            (id) => id in applyBoardOps(layout.latest(), ops).frames,
          ),
        ),
      );
      setAnnouncement(
        `${direction === "undo" ? "Undid" : "Redid"} ${entry.label.toLowerCase()}`,
      );
    },
    [layout],
  );
  const undo = useCallback(() => {
    replay("undo");
  }, [replay]);
  const redo = useCallback(() => {
    replay("redo");
  }, [replay]);

  const takeOwn = useCallback(() => {
    const taken = new Set(own.current);
    own.current.clear();
    return taken;
  }, []);

  return {
    frames,
    selection,
    setSelection,
    setDraft,
    commitRects,
    nudge,
    order,
    remove,
    undo,
    redo,
    canUndo: () => history.current.canUndo(),
    canRedo: () => history.current.canRedo(),
    status: layout.status,
    takeOwn,
    announcement,
  };
}
