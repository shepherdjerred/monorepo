import { useCallback, useEffect, useRef } from "react";
import type { Camera } from "#client/canvas/camera.ts";
import type { CameraController } from "#client/canvas/controller.ts";
import { useFollowCamera } from "#client/canvas/follow.ts";
import { paletteColor } from "./palette.ts";
import { TITLE_FONT, type Note } from "./shapes.ts";
import type { WorldRect } from "#client/canvas/camera.ts";

const STICKY_FONT = 18;
const MIN_TITLE_WIDTH = 160;

/**
 * The text of a sticky or title is edited in a textarea on the unscaled
 * overlay, sized and placed from the note through the camera so it lines up
 * with the text it replaces. Leaving the field saves, Escape abandons, and
 * Ctrl or Cmd with Enter saves.
 */
export function NoteEditor({
  controller,
  note,
  rect,
  onCommit,
  onCancel,
}: {
  readonly controller: CameraController;
  readonly note: Extract<Note, { type: "sticky" | "title" }>;
  readonly rect: WorldRect;
  readonly onCommit: (text: string) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const font = note.type === "sticky" ? STICKY_FONT : TITLE_FONT[note.size];
  const width =
    note.type === "sticky" ? rect.w : Math.max(rect.w, MIN_TITLE_WIDTH);
  const height =
    note.type === "sticky" ? rect.h : Math.max(rect.h, font * 1.25);
  const place = useCallback(
    (camera: Camera, element: HTMLElement) => {
      element.style.width = `${String(width * camera.s)}px`;
      element.style.height = `${String(height * camera.s)}px`;
      element.style.fontSize = `${String(font * camera.s)}px`;
      element.style.transform = `translate(${String(camera.x + rect.x * camera.s)}px, ${String(camera.y + rect.y * camera.s)}px)`;
    },
    [rect.x, rect.y, width, height, font],
  );
  useFollowCamera(controller, ref, place);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  function finish(commit: boolean, text: string): void {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(text);
    else onCancel();
  }

  const color = note.type === "sticky" ? paletteColor(note.color) : null;
  return (
    <textarea
      ref={ref}
      className="ar-annot-editor"
      data-testid="note-editor"
      data-cv-ignore=""
      aria-label={note.type === "sticky" ? "Sticky text" : "Title text"}
      defaultValue={note.text}
      data-kind={note.type}
      style={{
        background: color?.fill ?? "transparent",
        color: color?.ink ?? "inherit",
      }}
      onBlur={(event) => {
        finish(true, event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(false, "");
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          finish(true, event.currentTarget.value);
        }
      }}
    />
  );
}
