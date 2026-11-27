/**
 * What an annotation is as geometry: its bounds, how a rectangle moves or
 * resizes it, and whether a point hits it. Pure, so hit-testing is testable
 * without a DOM. Every annotation is a board `Note`.
 */
import type { BoardIndex } from "@shepherdjerred/artifacts/contract";
import type { Point } from "#client/lib/geometry.ts";
import type { WorldRect } from "#client/canvas/camera.ts";

export type Note = BoardIndex["notes"][string];

export type NoteModel = {
  readonly id: string;
  readonly note: Note;
  /** Position in `order`, shared with frames: its CSS z-index. */
  readonly z: number;
  readonly rect: WorldRect;
};

/** The pixel size of a title's text for each of its sizes. */
export const TITLE_FONT: Readonly<Record<"s" | "m" | "l", number>> = {
  s: 20,
  m: 32,
  l: 56,
};
export const STICKY_SIZE = { w: 200, h: 160 } as const;
/** Stroke width of lines, arrows, boxes and pen strokes, in world pixels. */
export const STROKE_WIDTH = 3;
/** A segment is hit within this many screen pixels (a 12 px transparent stroke). */
export const HIT_STROKE_PX = 12;

const LINE_HEIGHT = 1.25;
const CHAR_WIDTH = 0.58;

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
          ),
        );
  return Math.hypot(point.x - (a.x + along * dx), point.y - (a.y + along * dy));
}

function titleExtent(note: Extract<Note, { type: "title" }>): {
  w: number;
  h: number;
} {
  const size = TITLE_FONT[note.size];
  const lines = note.text.split("\n");
  const widest = Math.max(1, ...lines.map((line) => line.length));
  return {
    w: Math.max(size, widest * size * CHAR_WIDTH),
    h: Math.max(1, lines.length) * size * LINE_HEIGHT,
  };
}

function penPoints(note: Extract<Note, { type: "pen" }>): Point[] {
  return note.points.map(([x, y]) => ({ x: note.x + x, y: note.y + y }));
}

function boundsOfPoints(points: readonly Point[]): WorldRect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function noteBounds(note: Note): WorldRect {
  switch (note.type) {
    case "sticky":
    case "box":
      return { x: note.x, y: note.y, w: note.w, h: note.h };
    case "title":
      return { x: note.x, y: note.y, ...titleExtent(note) };
    case "line":
    case "arrow":
      return boundsOfPoints([
        { x: note.x, y: note.y },
        { x: note.x2, y: note.y2 },
      ]);
    case "pen":
      return boundsOfPoints(penPoints(note));
  }
}

function lerp(from: number, to: number, unit: number): number {
  return from + (to - from) * unit;
}

/** Where `value` sits between `low` and `low + length` as 0..1; the start when there is no length. */
function unitOf(value: number, low: number, length: number): number {
  return length === 0 ? 0 : (value - low) / length;
}

/**
 * The note moved and scaled to fill `rect`. A sticky and a box take it as
 * their rectangle; a line or arrow keeps its endpoints' places inside the
 * bounds; a title and a stroke keep their size and only move.
 */
export function withRect(note: Note, rect: WorldRect): Note {
  const from = noteBounds(note);
  switch (note.type) {
    case "sticky":
    case "box":
      return { ...note, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    case "line":
    case "arrow": {
      const point = (x: number, y: number): [number, number] => [
        lerp(rect.x, rect.x + rect.w, unitOf(x, from.x, from.w)),
        lerp(rect.y, rect.y + rect.h, unitOf(y, from.y, from.h)),
      ];
      const [x, y] = point(note.x, note.y);
      const [x2, y2] = point(note.x2, note.y2);
      return { ...note, x, y, x2, y2 };
    }
    case "title":
      return { ...note, x: rect.x, y: rect.y };
    case "pen":
      return {
        ...note,
        x: note.x + (rect.x - from.x),
        y: note.y + (rect.y - from.y),
      };
  }
}

/**
 * Whether `point` (world) hits the note at camera scale `scale`. Stickies and
 * titles are hit anywhere inside; a box only on its border and a line, arrow
 * or stroke only near the line, within half of a 12 screen-pixel stroke, so
 * thin shapes are easy to grab and an empty box does not block what is under it.
 */
export function hitNote(note: Note, point: Point, scale: number): boolean {
  const reach = HIT_STROKE_PX / 2 / scale + STROKE_WIDTH / 2;
  switch (note.type) {
    case "sticky":
    case "title":
      return insideRect(noteBounds(note), point, 0);
    case "box": {
      const rect = noteBounds(note);
      return (
        insideRect(rect, point, reach) &&
        !insideRect(shrink(rect, reach), point, 0)
      );
    }
    case "line":
    case "arrow":
      return (
        distanceToSegment(
          point,
          { x: note.x, y: note.y },
          { x: note.x2, y: note.y2 },
        ) <= reach
      );
    case "pen": {
      const points = penPoints(note);
      return points.some((current, at) => {
        const next = points[at + 1];
        return (
          next !== undefined && distanceToSegment(point, current, next) <= reach
        );
      });
    }
  }
}

function insideRect(rect: WorldRect, point: Point, margin: number): boolean {
  return (
    point.x >= rect.x - margin &&
    point.x <= rect.x + rect.w + margin &&
    point.y >= rect.y - margin &&
    point.y <= rect.y + rect.h + margin
  );
}

function shrink(rect: WorldRect, by: number): WorldRect {
  return {
    x: rect.x + by,
    y: rect.y + by,
    w: Math.max(0, rect.w - 2 * by),
    h: Math.max(0, rect.h - 2 * by),
  };
}

/** The annotations of a board index, in a stable order (their ids), with their z from `order`. */
export function noteModels(
  index: Pick<BoardIndex, "notes" | "order">,
  page = 0,
): NoteModel[] {
  const stacking = new Map(index.order.map((id, position) => [id, position]));
  return Object.entries(index.notes)
    .filter(([, note]) => note.page === page)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([id, note]) => ({
      id,
      note,
      z: stacking.get(id) ?? 0,
      rect: noteBounds(note),
    }));
}

/** The topmost note under `point`, or null. */
export function topNoteAt(
  models: readonly NoteModel[],
  point: Point,
  scale: number,
): NoteModel | null {
  let top: NoteModel | null = null;
  for (const model of models)
    if (hitNote(model.note, point, scale) && (top === null || model.z > top.z))
      top = model;
  return top;
}
