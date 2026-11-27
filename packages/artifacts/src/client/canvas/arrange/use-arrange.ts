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
import {
  noteModels,
  withRect,
  type Note,
  type NoteModel,
} from "#client/canvas/notes/shapes.ts";
import { opsForNudge, opsForRects, opsForRemove } from "./builders.ts";
import { createHistory } from "./history.ts";
import { NUDGE, NUDGE_FAST, stepOrder, type OrderStep } from "./geometry.ts";
import { entryBetween, entryOps } from "./ops.ts";
import { useBoardLayout, type SaveStatus } from "./use-layout.ts";

export type Arrange = {
  /** The frames to draw: server index, edits not yet saved, and any drag in progress. */
  readonly frames: readonly CanvasFrameModel[];
  /** The annotations to draw, with any drag, resize or endpoint drag in progress. */
  readonly notes: readonly NoteModel[];
  readonly selection: ReadonlySet<string>;
  readonly setSelection: (selection: ReadonlySet<string>) => void;
  /** Live positions of the frames being dragged or resized, or null. */
  readonly setDraft: (draft: ReadonlyMap<string, WorldRect> | null) => void;
  /** Whole-note drafts (an endpoint drag, a new shape being drawn), or null. */
  readonly setNoteDraft: (draft: ReadonlyMap<string, Note> | null) => void;
  /** Saves a finished edit of one annotation (create, text, colour, endpoint) as an undo step. */
  readonly putNote: (
    label: string,
    id: string,
    note: Note,
    key?: string,
  ) => void;
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
      case "putNote":
      case "deleteNote":
        return [op.id];
      case "reorder":
      case "setLaunch":
        return [];
    }
  });
}

function nameOf(artifacts: BoardData["artifacts"], id: string): string {
  return (
    artifacts.find((artifact) => artifact.id === id)?.title ?? "annotation"
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
  const [noteDraft, setNoteDraft] = useState<ReadonlyMap<string, Note> | null>(
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

  const notes = useMemo(
    () =>
      noteModels(layout.index).map((model) => {
        const whole = noteDraft?.get(model.id);
        const rect = draft?.get(model.id);
        const note =
          whole ??
          (rect === undefined ? model.note : withRect(model.note, rect));
        return note === model.note
          ? model
          : { ...model, note, rect: rect ?? model.rect };
      }),
    [layout.index, draft, noteDraft],
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
      const ops = opsForRects(layout.latest(), rects);
      const done = ops.length === 0 ? null : edit(label, ops);
      setDraft(null);
      const [first] = [...rects.keys()];
      if (done !== null && first !== undefined)
        setAnnouncement(
          `${label === "Resize" ? "Resized" : "Moved"} ${rects.size === 1 ? nameOf(artifacts.current, first) : `${String(rects.size)} items`}`,
        );
    },
    [edit, layout],
  );

  const putNote = useCallback(
    (label: string, id: string, note: Note, key?: string) => {
      edit(label, [{ op: "putNote", id, note }], key);
      setNoteDraft(null);
      setAnnouncement(label);
    },
    [edit],
  );

  const nudge = useCallback(
    (dx: number, dy: number, fast: boolean) => {
      const step = fast ? NUDGE_FAST : NUDGE;
      const ops = opsForNudge(
        layout.latest(),
        selectionRef.current,
        dx * step,
        dy * step,
      );
      if (ops.length === 0) return;
      edit("Nudge", ops, "nudge");
      setAnnouncement(
        `Moved ${selectionRef.current.size === 1 ? "1 item" : `${String(selectionRef.current.size)} items`} by ${String(dx * step)}, ${String(dy * step)}`,
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
    const ops = opsForRemove(layout.latest(), selectionRef.current);
    if (ops.length === 0) return;
    edit("Delete", ops);
    setSelection(new Set());
    setAnnouncement(
      `Removed ${ops.length === 1 ? "1 item" : `${String(ops.length)} items`} from the board`,
    );
  }, [edit, layout]);

  const replay = useCallback(
    (direction: "undo" | "redo") => {
      const entry =
        direction === "undo" ? history.current.undo() : history.current.redo();
      if (entry === null) return;
      const ops = entryOps(entry, direction, layout.latest());
      for (const id of entry.frames.keys()) own.current.add(id);
      for (const id of entry.notes.keys()) own.current.add(id);
      layout.apply(ops);
      setSelection(
        new Set(
          [...entry.frames.keys(), ...entry.notes.keys()].filter((id) => {
            const next = applyBoardOps(layout.latest(), ops);
            return id in next.frames || id in next.notes;
          }),
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
    notes,
    selection,
    setSelection,
    setDraft,
    setNoteDraft,
    putNote,
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
