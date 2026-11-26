import type { CameraController } from "#client/canvas/controller.ts";
import { EndpointHandles } from "#client/canvas/arrange/handles.tsx";
import type { PointerSession } from "#client/canvas/gestures.ts";
import type { Point } from "#client/lib/geometry.ts";
import { NoteEditor } from "./note-editor.tsx";
import { NoteView } from "./notes-layer.tsx";
import { PalettePill } from "./palette-pill.tsx";
import { noteBounds, type Note, type NoteModel } from "./shapes.ts";
import type { Editing } from "./use-notes.ts";

/** Every annotation in the world layer, the shape being drawn, and a new one being typed. */
export function NoteWorld({
  notes,
  preview,
  editing,
}: {
  readonly notes: readonly NoteModel[];
  readonly preview: Note | null;
  readonly editing: Editing | null;
}): React.JSX.Element {
  const transient = (id: string, note: Note): NoteModel => ({
    id,
    note,
    // Above everything while it is being made.
    z: Number.MAX_SAFE_INTEGER / 2,
    rect: noteBounds(note),
  });
  return (
    <>
      {notes.map((model) => (
        <NoteView
          key={model.id}
          model={model}
          editing={editing?.id === model.id}
        />
      ))}
      {preview === null ? null : (
        <NoteView model={transient("preview", preview)} editing={false} />
      )}
      {editing?.isNew === true ? (
        <NoteView model={transient(editing.id, editing.note)} editing />
      ) : null}
    </>
  );
}

/** The text editor, the endpoint handles of a selected line or arrow, and the colour palette. */
export function NoteOverlay({
  controller,
  editing,
  onCommit,
  onCancel,
  onlyNote,
  startEndpoint,
  palette,
}: {
  readonly controller: CameraController;
  readonly editing: Editing | null;
  readonly onCommit: (text: string) => void;
  readonly onCancel: () => void;
  readonly onlyNote: NoteModel | undefined;
  readonly startEndpoint: (
    id: string,
    end: "start" | "end",
    point: Point,
  ) => PointerSession | null;
  readonly palette: {
    readonly shown: boolean;
    readonly color: string;
    readonly titleSize: "s" | "m" | "l" | null;
    readonly onColor: (id: string) => void;
    readonly onTitleSize: (size: "s" | "m" | "l") => void;
  } | null;
}): React.JSX.Element {
  const segment =
    onlyNote?.note.type === "line" || onlyNote?.note.type === "arrow"
      ? onlyNote
      : undefined;
  return (
    <>
      {editing === null ? null : (
        <NoteEditor
          key={editing.id}
          controller={controller}
          note={editing.note}
          rect={noteBounds(editing.note)}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      )}
      {segment === undefined ||
      (segment.note.type !== "line" && segment.note.type !== "arrow") ? null : (
        <EndpointHandles
          key={segment.id}
          controller={controller}
          from={{ x: segment.note.x, y: segment.note.y }}
          to={{ x: segment.note.x2, y: segment.note.y2 }}
          start={(end, point) => startEndpoint(segment.id, end, point)}
        />
      )}
      {palette?.shown === true ? (
        <PalettePill
          color={palette.color}
          titleSize={palette.titleSize}
          onColor={palette.onColor}
          onTitleSize={palette.onTitleSize}
        />
      ) : null}
    </>
  );
}
