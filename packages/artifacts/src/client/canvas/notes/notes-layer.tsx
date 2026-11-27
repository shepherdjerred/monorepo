import { memo } from "react";
import { paletteColor } from "./palette.ts";
import {
  noteBounds,
  STROKE_WIDTH,
  TITLE_FONT,
  type Note,
  type NoteModel,
} from "./shapes.ts";

const ARROW_HEAD = 16;

/** The arrowhead at `(x2, y2)` for a line from `(x, y)`, as an SVG path. */
export function arrowHead(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  const point = (turn: number) =>
    `${String(to.x - Math.cos(angle + turn) * ARROW_HEAD)} ${String(to.y - Math.sin(angle + turn) * ARROW_HEAD)}`;
  return `M${point(spread)}L${String(to.x)} ${String(to.y)}L${point(-spread)}`;
}

function SegmentSvg({
  note,
}: {
  readonly note: Extract<Note, { type: "line" | "arrow" }>;
}): React.JSX.Element {
  const stroke = paletteColor(note.color).stroke;
  const bounds = noteBounds(note);
  const from = { x: note.x - bounds.x, y: note.y - bounds.y };
  const to = { x: note.x2 - bounds.x, y: note.y2 - bounds.y };
  return (
    <svg
      className="ar-annot-svg"
      width={Math.max(1, bounds.w)}
      height={Math.max(1, bounds.h)}
      aria-hidden="true"
    >
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
      />
      {note.type === "arrow" ? (
        <path
          d={arrowHead(from, to)}
          fill="none"
          stroke={stroke}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}

function PenSvg({
  note,
}: {
  readonly note: Extract<Note, { type: "pen" }>;
}): React.JSX.Element {
  const bounds = noteBounds(note);
  const d = note.points
    .map(
      ([x, y], at) =>
        `${at === 0 ? "M" : "L"}${String(note.x + x - bounds.x)} ${String(note.y + y - bounds.y)}`,
    )
    .join("");
  return (
    <svg
      className="ar-annot-svg"
      width={Math.max(1, bounds.w)}
      height={Math.max(1, bounds.h)}
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke={paletteColor(note.color).stroke}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Body({
  note,
  editing,
}: {
  readonly note: Note;
  readonly editing: boolean;
}): React.JSX.Element | null {
  switch (note.type) {
    case "sticky": {
      const color = paletteColor(note.color);
      return (
        <div
          className="ar-annot-sticky"
          style={{ background: color.fill, color: color.ink }}
        >
          {editing ? "" : note.text}
        </div>
      );
    }
    case "title":
      return (
        <div
          className="ar-annot-title"
          style={{ fontSize: TITLE_FONT[note.size] }}
        >
          {editing ? "" : note.text}
        </div>
      );
    case "box":
      return (
        <div
          className="ar-annot-box"
          style={{
            borderColor: paletteColor(note.color).stroke,
            borderWidth: STROKE_WIDTH,
          }}
        />
      );
    case "line":
    case "arrow":
      return <SegmentSvg note={note} />;
    case "pen":
      return <PenSvg note={note} />;
  }
}

/**
 * One annotation in the world layer, drawn from the board index. It never takes
 * a pointer: hit-testing is geometry (`shapes.ts`), so a thin line is easy to
 * grab and an empty box does not block what is under it. Stacking is the
 * shared `order`, like frames.
 */
export const NoteView = memo(function NoteViewBody({
  model,
  editing,
}: {
  readonly model: NoteModel;
  readonly editing: boolean;
}): React.JSX.Element {
  const { rect, note, z, id } = model;
  return (
    <div
      className="ar-annot"
      data-testid="note"
      data-note-id={id}
      data-kind={note.type}
      style={{
        transform: `translate(${String(rect.x)}px, ${String(rect.y)}px)`,
        width: Math.max(1, rect.w),
        height: Math.max(1, rect.h),
        zIndex: z + 1,
      }}
    >
      <Body note={note} editing={editing} />
    </div>
  );
});
