import type { Point } from "#client/lib/geometry.ts";
import { rectBetween } from "#client/canvas/arrange/geometry.ts";
import { STICKY_SIZE, type Note } from "./shapes.ts";

export type DrawTool = "text" | "sticky" | "pen" | "box" | "line" | "arrow";

/** A drag shorter than this makes no box, line or arrow. */
export const MIN_DRAW_PX = 6;

/** A fresh note id: short, unique, and valid for the contract (`[\w-]{1,64}`). */
export function newNoteId(): string {
  return `n-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

/** `to` brought to the nearest 45 degrees from `from` (Shift while drawing a line or arrow). */
export function snapAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return to;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return {
    x: from.x + Math.cos(angle) * length,
    y: from.y + Math.sin(angle) * length,
  };
}

/**
 * The note a drag from `from` to `to` draws with `tool`, or null when it is too
 * small to be one. A sticky or a text click without a drag takes its default
 * size or none. Pen strokes are built point by point, not here.
 */
export function drawNote(
  tool: Exclude<DrawTool, "pen">,
  from: Point,
  to: Point,
  options: { readonly color: string; readonly constrain: boolean },
): Note | null {
  const { color } = options;
  const dragged = Math.hypot(to.x - from.x, to.y - from.y) >= MIN_DRAW_PX;
  switch (tool) {
    case "text":
      return {
        type: "title",
        page: 0,
        x: from.x,
        y: from.y,
        text: "",
        size: "m",
      };
    case "sticky": {
      const rect = dragged
        ? rectBetween(from, to)
        : { x: from.x, y: from.y, ...STICKY_SIZE };
      return {
        type: "sticky",
        page: 0,
        x: rect.x,
        y: rect.y,
        w: Math.max(80, rect.w),
        h: Math.max(60, rect.h),
        text: "",
        color,
      };
    }
    case "box": {
      if (!dragged) return null;
      const rect = rectBetween(from, to);
      return { type: "box", page: 0, ...rect, color };
    }
    case "line":
    case "arrow": {
      if (!dragged) return null;
      const end = options.constrain ? snapAngle(from, to) : to;
      return {
        type: tool,
        page: 0,
        x: from.x,
        y: from.y,
        x2: end.x,
        y2: end.y,
        color,
      };
    }
  }
}
