import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Point } from "#client/lib/geometry.ts";
import type { Arrange } from "#client/canvas/arrange/use-arrange.ts";
import { screenToWorld } from "#client/canvas/camera.ts";
import type { CameraController } from "#client/canvas/controller.ts";
import { isDrawTool, type Tool } from "#client/canvas/gestures.ts";
import type { CanvasFrameModel } from "#client/canvas/model.ts";
import { drawNote, newNoteId } from "./create.ts";
import { DEFAULT_COLOR } from "./palette.ts";
import { noteBounds, topNoteAt, type Note, type NoteModel } from "./shapes.ts";

/** A note whose text is being typed; a new one is not on the board until it has text. */
export type Editing = {
  readonly id: string;
  readonly note: Extract<Note, { type: "sticky" | "title" }>;
  readonly isNew: boolean;
};

const LABEL: Readonly<Record<Note["type"], string>> = {
  sticky: "Add sticky",
  title: "Add text",
  box: "Add box",
  line: "Add line",
  arrow: "Add arrow",
  pen: "Add drawing",
};

/** The note when it carries text (a sticky or a title), else null. */
function textNote(note: Note): Editing["note"] | null {
  switch (note.type) {
    case "sticky":
    case "title":
      return note;
    case "box":
    case "line":
    case "arrow":
    case "pen":
      return null;
  }
}

/** Rounds a note's coordinates to a tenth of a pixel so what is stored is tidy. */
function tidy(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Annotation state of the canvas: the colour new ones are drawn in, the shape
 * being drawn, the text being edited, creating from a click or a finished
 * drag, and picking the topmost one under a point. A drawing tool reverts to
 * select after one shape unless Shift is held when the shape is finished.
 */
export function useNotes({
  arrange,
  controller,
  frames,
  tool,
  selectTool,
}: {
  readonly arrange: Arrange;
  readonly controller: CameraController;
  readonly frames: ReadonlyMap<string, CanvasFrameModel>;
  readonly tool: Tool;
  readonly selectTool: () => void;
}) {
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [preview, setPreview] = useState<Note | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const shift = useRef(false);
  const latest = useRef({ arrange, frames, tool, selectTool, color });
  latest.current = { arrange, frames, tool, selectTool, color };

  useEffect(() => {
    function track(event: KeyboardEvent): void {
      shift.current = event.shiftKey;
    }
    globalThis.addEventListener("keydown", track);
    globalThis.addEventListener("keyup", track);
    return () => {
      globalThis.removeEventListener("keydown", track);
      globalThis.removeEventListener("keyup", track);
    };
  }, []);

  const finishShape = useCallback(() => {
    if (!shift.current) latest.current.selectTool();
  }, []);

  const startEdit = useCallback((id: string) => {
    const model = latest.current.arrange.notes.find((entry) => entry.id === id);
    const text = model === undefined ? null : textNote(model.note);
    if (text === null) return;
    latest.current.arrange.setSelection(new Set([id]));
    setEditing({ id, note: text, isNew: false });
  }, []);

  /** A finished drag: a sticky opens its editor, every other kind is stored at once. */
  const onCreate = useCallback(
    (note: Note) => {
      const id = newNoteId();
      const text = textNote(note);
      if (text !== null) {
        setEditing({ id, note: text, isNew: true });
        return;
      }
      latest.current.arrange.putNote(LABEL[note.type], id, note);
      latest.current.arrange.setSelection(new Set([id]));
      finishShape();
    },
    [finishShape],
  );

  /** A click with the text or sticky tool: a title or a default sticky at the point. */
  const createAt = useCallback(
    (point: Point) => {
      const { tool: active, color: current } = latest.current;
      if (active !== "text" && active !== "sticky") return;
      const world = screenToWorld(controller.get(), point);
      const note = drawNote(active, world, world, {
        color: current,
        constrain: false,
      });
      if (note !== null) onCreate(note);
    },
    [controller, onCreate],
  );

  const commitText = useCallback(
    (text: string) => {
      const open = editing;
      setEditing(null);
      if (open === null) return;
      const trimmed = text.trimEnd();
      if (open.isNew) {
        if (trimmed === "") {
          return;
        }
        latest.current.arrange.putNote(LABEL[open.note.type], open.id, {
          ...open.note,
          x: tidy(open.note.x),
          y: tidy(open.note.y),
          text: trimmed,
        });
        latest.current.arrange.setSelection(new Set([open.id]));
        finishShape();
        return;
      }
      if (trimmed !== open.note.text)
        latest.current.arrange.putNote("Edit text", open.id, {
          ...open.note,
          text: trimmed,
        });
    },
    [editing, finishShape],
  );
  const cancelText = useCallback(() => {
    setEditing(null);
    if (editing?.isNew === true) finishShape();
  }, [editing, finishShape]);

  /** The topmost annotation above whatever frame the DOM found, or that frame. */
  const pick = useCallback(
    (point: Point, frame: string | null): string | null => {
      const { arrange: current, frames: byId } = latest.current;
      const camera = controller.get();
      const hit = topNoteAt(
        current.notes,
        screenToWorld(camera, point),
        camera.s,
      );
      if (hit === null) return frame;
      const frameZ = frame === null ? -1 : (byId.get(frame)?.z ?? -1);
      return hit.z > frameZ ? hit.id : frame;
    },
    [controller],
  );

  const selectedNotes = useMemo(
    () => arrange.notes.filter((model) => arrange.selection.has(model.id)),
    [arrange.notes, arrange.selection],
  );

  /** Colours the annotations drawn next and the selected ones that have a colour. */
  const applyColor = useCallback((id: string) => {
    setColor(id);
    for (const model of latest.current.arrange.notes) {
      if (!latest.current.arrange.selection.has(model.id)) continue;
      const { note } = model;
      if (note.type === "title") continue;
      latest.current.arrange.putNote("Recolour", model.id, {
        ...note,
        color: id,
      });
    }
  }, []);

  const applyTitleSize = useCallback((size: "s" | "m" | "l") => {
    for (const model of latest.current.arrange.notes)
      if (
        latest.current.arrange.selection.has(model.id) &&
        model.note.type === "title"
      )
        latest.current.arrange.putNote("Resize text", model.id, {
          ...model.note,
          size,
        });
  }, []);

  const only: NoteModel | undefined =
    selectedNotes.length === 1 ? selectedNotes[0] : undefined;
  const titleSize =
    selectedNotes.length > 0 &&
    selectedNotes.every((model) => model.note.type === "title") &&
    only?.note.type === "title"
      ? only.note.size
      : null;
  const paletteShown =
    isDrawTool(tool) ||
    selectedNotes.some((model) => model.note.type !== "title") ||
    titleSize !== null;

  // The palette shows the selected annotation's colour, else the one drawn next.
  const shownColor =
    only === undefined || only.note.type === "title"
      ? color
      : (only.note.color ?? color);

  return {
    shiftHeld: () => shift.current,
    color,
    shownColor,
    preview,
    setPreview,
    editing,
    startEdit,
    onCreate,
    createAt,
    commitText,
    cancelText,
    pick,
    selectedNotes,
    onlyNote: only,
    applyColor,
    applyTitleSize,
    titleSize,
    paletteShown,
    editingRect: editing === null ? null : noteBounds(editing.note),
  };
}
