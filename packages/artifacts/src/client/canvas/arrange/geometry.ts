/**
 * Pure geometry of arranging frames: grid snapping, marquee hit-testing,
 * the eight resize handles and z-order steps. Nothing here knows about the DOM.
 */
import { clamp, type Point } from "#client/lib/geometry.ts";
import { intersects, type WorldRect } from "#client/canvas/camera.ts";

/** Frames snap to this grid, in world pixels; Alt disables it. */
export const GRID = 8;
/** No frame is resized below this. */
export const MIN_WIDTH = 96;
export const MIN_HEIGHT = 64;
/** A step of the arrow keys, and of Shift+arrow. */
export const NUDGE = 1;
export const NUDGE_FAST = 10;

export function snap(value: number, grid = GRID): number {
  return Math.round(value / grid) * grid;
}

/**
 * The delta that moves `lead` by `delta` and lands its corner on the grid.
 * Every frame of a multi-selection takes the same delta, so they keep their
 * relative positions.
 */
export function snapDelta(
  lead: WorldRect,
  delta: Point,
  enabled: boolean,
): Point {
  if (!enabled) return delta;
  return {
    x: snap(lead.x + delta.x) - lead.x,
    y: snap(lead.y + delta.y) - lead.y,
  };
}

export function moveRect(rect: WorldRect, delta: Point): WorldRect {
  return { ...rect, x: rect.x + delta.x, y: rect.y + delta.y };
}

// ── Marquee ─────────────────────────────────────────────────────────────────

/** The rectangle between two world points, whichever way the drag went. */
export function rectBetween(a: Point, b: Point): WorldRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** The ids of the frames a marquee touches. */
export function framesInMarquee(
  frames: readonly { readonly id: string; readonly rect: WorldRect }[],
  marquee: WorldRect,
): string[] {
  return frames
    .filter((frame) => intersects(frame.rect, marquee))
    .map((frame) => frame.id);
}

/** Shift adds the marquee's frames to the selection; without it they replace it. */
export function marqueeSelection(
  base: ReadonlySet<string>,
  hits: readonly string[],
  additive: boolean,
): Set<string> {
  return additive ? new Set([...base, ...hits]) : new Set(hits);
}

/** A click with Shift toggles a frame; a plain click selects only it. */
export function clickSelection(
  current: ReadonlySet<string>,
  id: string,
  additive: boolean,
): Set<string> {
  if (!additive) return new Set([id]);
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// ── Resize ──────────────────────────────────────────────────────────────────

export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];

type Edges = {
  readonly left: boolean;
  readonly right: boolean;
  readonly top: boolean;
  readonly bottom: boolean;
};

function edgesOf(handle: Handle): Edges {
  return {
    left: handle.includes("w"),
    right: handle.includes("e"),
    top: handle.includes("n"),
    bottom: handle.includes("s"),
  };
}

type Size2 = { readonly width: number; readonly height: number };

/** `size` forced to `aspect` (when there is one), then lifted to the minimum while holding it. */
function withAspect(
  size: Size2,
  context: {
    readonly edges: Edges;
    readonly start: WorldRect;
    readonly aspect: number | null;
  },
): Size2 {
  const { edges, start, aspect } = context;
  if (aspect === null) return size;
  const horizontal = edges.left || edges.right;
  const vertical = edges.top || edges.bottom;
  let { width, height } = size;
  if (horizontal && vertical) {
    // A corner: whichever dimension grew more (relative to the start) leads.
    if (width / start.w >= height / start.h) height = width / aspect;
    else width = height * aspect;
  } else if (horizontal) height = width / aspect;
  else width = height * aspect;
  if (width < MIN_WIDTH) {
    width = MIN_WIDTH;
    height = width / aspect;
  }
  if (height < MIN_HEIGHT) {
    height = MIN_HEIGHT;
    width = height * aspect;
  }
  return { width, height };
}

export type ResizeOptions = {
  /** Width over height to keep (a fixed-viewport frame), or null to resize freely. */
  readonly aspect: number | null;
  readonly snap: boolean;
};

/**
 * `start` resized by dragging `handle` by `delta`. The opposite edge or corner
 * stays put. With an aspect the frame keeps it: a corner follows the larger
 * of the two moves, an edge drives the other dimension from the frame's
 * anchored side.
 */
export function resizeRect(
  start: WorldRect,
  handle: Handle,
  delta: Point,
  options: ResizeOptions,
): WorldRect {
  const edges = edgesOf(handle);
  const grid = (value: number): number => (options.snap ? snap(value) : value);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (edges.left) left = grid(start.x + delta.x);
  if (edges.right) right = grid(start.x + start.w + delta.x);
  if (edges.top) top = grid(start.y + delta.y);
  if (edges.bottom) bottom = grid(start.y + start.h + delta.y);

  const sized = withAspect(
    {
      width: Math.max(MIN_WIDTH, right - left),
      height: Math.max(MIN_HEIGHT, bottom - top),
    },
    { edges, start, aspect: options.aspect },
  );
  const { width, height } = sized;

  // The edge opposite the handle is the anchor; a pure vertical or horizontal
  // handle keeps the frame's other axis anchored at its start.
  const x = edges.left ? start.x + start.w - width : start.x;
  const y = edges.top ? start.y + start.h - height : start.y;
  return { x, y, w: width, h: height };
}

/** Where a handle sits on a rectangle, as fractions of its size. */
export function handlePosition(handle: Handle): Point {
  const edges = edgesOf(handle);
  return {
    x: edges.left ? 0 : edges.right ? 1 : 0.5,
    y: edges.top ? 0 : edges.bottom ? 1 : 0.5,
  };
}

export const HANDLE_CURSOR: Readonly<Record<Handle, string>> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

// ── Z-order ─────────────────────────────────────────────────────────────────

export type OrderStep = "forward" | "backward" | "front" | "back";

/**
 * `order` (back to front) after moving the selected entries: one step past the
 * nearest unselected neighbour, or to an end. The selected keep their
 * relative order.
 */
export function stepOrder(
  order: readonly string[],
  selected: ReadonlySet<string>,
  step: OrderStep,
): string[] {
  const picked = order.filter((id) => selected.has(id));
  if (picked.length === 0) return [...order];
  const rest = order.filter((id) => !selected.has(id));
  if (step === "front") return [...rest, ...picked];
  if (step === "back") return [...picked, ...rest];
  const result = [...order];
  const indices = result.flatMap((id, at) => (selected.has(id) ? [at] : []));
  const ordered = step === "forward" ? [...indices].reverse() : indices;
  for (const at of ordered) {
    const to = at + (step === "forward" ? 1 : -1);
    const neighbour = result[to];
    const current = result[at];
    if (neighbour === undefined || current === undefined) continue;
    if (selected.has(neighbour)) continue;
    result[to] = current;
    result[at] = neighbour;
  }
  return result;
}

/** A frame size within the limits, for a frame placed or restored with odd values. */
export function clampSize(rect: WorldRect): WorldRect {
  return {
    ...rect,
    w: clamp(rect.w, MIN_WIDTH, 100_000),
    h: clamp(rect.h, MIN_HEIGHT, 100_000),
  };
}
