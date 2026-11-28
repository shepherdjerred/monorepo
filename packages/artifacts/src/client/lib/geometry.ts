/**
 * Coordinate math shared by the viewers. Every function is pure: the viewers
 * measure the DOM and pass rectangles in, so the math is testable without one.
 */
import type { Anchor } from "@shepherdjerred/artifacts/contract";

export type Point = { readonly x: number; readonly y: number };
export type Rect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export function clamp(value: number, min: number, max: number): number {
  return Number.isNaN(value) ? min : Math.min(max, Math.max(min, value));
}

export function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}

export function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  );
}

/** A client point as a fraction of `rect`, clamped to the unit square. */
export function normalizeInRect(rect: Rect, point: Point): Point | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: clampUnit((point.x - rect.left) / rect.width),
    y: clampUnit((point.y - rect.top) / rect.height),
  };
}

/** The client point of a unit-square position inside `rect`. */
export function denormalizeInRect(rect: Rect, unit: Point): Point {
  return {
    x: rect.left + unit.x * rect.width,
    y: rect.top + unit.y * rect.height,
  };
}

// ── Frames (sandboxed iframes) ──────────────────────────────────────────────

/** What the bridge told the host about the document inside a frame. */
export type DocState = {
  readonly scrollX: number;
  readonly scrollY: number;
  /** The document's scroll width and height in CSS px. */
  readonly width: number;
  readonly height: number;
  readonly path: string;
};

/**
 * A client point as a position in the frame's own CSS pixels. The frame is
 * drawn at `scale` (CSS transform), so a rect measured after the transform
 * is `scale` times the frame's viewport.
 */
export function clientToFramePixels(
  rect: Rect,
  scale: number,
  point: Point,
): Point | null {
  return scale <= 0 || rect.width <= 0
    ? null
    : { x: (point.x - rect.left) / scale, y: (point.y - rect.top) / scale };
}

/** The `frame` anchor of a point: fractions of the frame's viewport. */
export function frameAnchor(rect: Rect, point: Point): Anchor | null {
  const unit = normalizeInRect(rect, point);
  return unit === null ? null : { type: "frame", x: unit.x, y: unit.y };
}

/**
 * The `doc` anchor of a frame pixel, from the last scroll and size the bridge
 * reported. `x` is a fraction of the document width, `y` is document pixels.
 */
export function docAnchorFromFramePixels(
  pixels: Point,
  doc: DocState,
  viewportWidth: number,
): Anchor {
  const docWidth = Math.max(1, doc.width > 0 ? doc.width : viewportWidth);
  return {
    type: "doc",
    path: doc.path,
    x: clampUnit((pixels.x + doc.scrollX) / docWidth),
    y: Math.max(0, pixels.y + doc.scrollY),
    docWidth,
  };
}

/**
 * The frame pixel a `doc` anchor is at now. A document that reflowed to a
 * different width scales the stored `y` by the width ratio, which is the best
 * a position without an element can do.
 */
export function framePixelsFromDocAnchor(
  anchor: Extract<Anchor, { type: "doc" }>,
  doc: DocState,
  viewportWidth: number,
): Point {
  const width = Math.max(1, doc.width > 0 ? doc.width : viewportWidth);
  const ratio = width / anchor.docWidth;
  return {
    x: anchor.x * width - doc.scrollX,
    y: anchor.y * ratio - doc.scrollY,
  };
}

/** The client point of a frame pixel (the inverse of `clientToFramePixels`). */
export function framePixelsToClient(
  rect: Rect,
  scale: number,
  pixels: Point,
): Point {
  return { x: rect.left + pixels.x * scale, y: rect.top + pixels.y * scale };
}

// ── PDF pages ───────────────────────────────────────────────────────────────

export type Rotation = 0 | 90 | 180 | 270;

const ROTATIONS = [0, 90, 180, 270] as const;

export function normalizeRotation(degrees: number): Rotation {
  const turn = ((Math.round(degrees / 90) % 4) + 4) % 4;
  return ROTATIONS[turn] ?? 0;
}

/**
 * Display coordinates (a fraction of the page as drawn, rotated clockwise by
 * `rotation`) to the unrotated page's coordinates, origin top-left.
 */
export function displayToPage(unit: Point, rotation: Rotation): Point {
  switch (rotation) {
    case 0:
      return { x: unit.x, y: unit.y };
    case 90:
      return { x: unit.y, y: 1 - unit.x };
    case 180:
      return { x: 1 - unit.x, y: 1 - unit.y };
    case 270:
      return { x: 1 - unit.y, y: unit.x };
  }
}

/** The inverse of `displayToPage`. */
export function pageToDisplay(page: Point, rotation: Rotation): Point {
  switch (rotation) {
    case 0:
      return { x: page.x, y: page.y };
    case 90:
      return { x: 1 - page.y, y: page.x };
    case 180:
      return { x: 1 - page.x, y: 1 - page.y };
    case 270:
      return { x: page.y, y: 1 - page.x };
  }
}

/** The `page` anchor (1-based page) of a client point over a drawn page. */
export function pageAnchor(
  pageNumber: number,
  pageRect: Rect,
  rotation: Rotation,
  point: Point,
): Anchor | null {
  const unit = normalizeInRect(pageRect, point);
  if (unit === null) return null;
  const page = displayToPage(unit, rotation);
  return { type: "page", page: pageNumber, x: page.x, y: page.y };
}

/** The client point of a `page` anchor over its drawn page. */
export function pageAnchorToClient(
  anchor: Extract<Anchor, { type: "page" }>,
  pageRect: Rect,
  rotation: Rotation,
): Point {
  return denormalizeInRect(pageRect, pageToDisplay(anchor, rotation));
}

/**
 * The device-pixel scale a PDF page is rendered at: `cssScale × dpr`, lowered
 * so the canvas never exceeds `maxPixels` (16 MP by default).
 */
export function pdfRenderScale(options: {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly cssScale: number;
  readonly dpr: number;
  readonly maxPixels?: number;
}): number {
  const {
    pageWidth,
    pageHeight,
    cssScale,
    dpr,
    maxPixels = 16_000_000,
  } = options;
  const wanted = Math.max(0.1, cssScale * Math.max(1, dpr));
  const pixels = pageWidth * pageHeight * wanted * wanted;
  return pixels <= maxPixels
    ? wanted
    : Math.sqrt(maxPixels / (pageWidth * pageHeight));
}

// ── Scrolled content (markdown) ─────────────────────────────────────────────

/**
 * A point in a scrolled column as a `doc` position: `x` is a fraction of the
 * content width, `y` is content pixels from the top of the content.
 */
export function contentAnchor(
  path: string,
  contentRect: Rect,
  point: Point,
): Anchor | null {
  if (contentRect.width <= 0) return null;
  return {
    type: "doc",
    path,
    x: clampUnit((point.x - contentRect.left) / contentRect.width),
    y: Math.max(0, point.y - contentRect.top),
    docWidth: contentRect.width,
  };
}

/** `contentRect.top` already includes the scroll offset (it is the content's own box). */
export function contentAnchorToClient(
  anchor: Extract<Anchor, { type: "doc" }>,
  contentRect: Rect,
): Point {
  const ratio = contentRect.width / anchor.docWidth;
  return {
    x: contentRect.left + anchor.x * contentRect.width,
    y: contentRect.top + anchor.y * ratio,
  };
}
