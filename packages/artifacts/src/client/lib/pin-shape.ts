/**
 * The comment pin and the comment cursor are the toolbar's lucide
 * `MessageCircle` glyph, with its path read from lucide's own icon data so
 * nothing is hand-drawn and nothing can drift. The glyph's tail is the point:
 * the stored anchor is the tail's tip, not the bubble's centre, so everything
 * that positions a pin places the *tip* at the anchor point.
 */
import { __iconData } from "lucide-react/icons/message-circle";
import type { Point } from "./geometry.ts";

const [firstNode] = __iconData.node;
/** The glyph's outline in its own 24 x 24 box. */
export const ICON_PATH = firstNode?.[1].d ?? "";
export const ICON_SIZE = __iconData.size;

/**
 * The tail tip in the glyph's box: the point of the tail's rounded corner
 * nearest the bottom-left of the box (the middle of its radius-1 arc from
 * (2.021, 20.799) to (3.257, 21.967)). `pin-shape.test.ts` pins the path, so a
 * lucide update that moves the tail fails there and this is revisited.
 */
export const ICON_TIP: Point = { x: 2.314, y: 21.727 };

/** The pin is the glyph at 28 px: a 28 x 28 box (a 24 px or larger target). */
export const PIN_SIZE = 28;
const PIN_SCALE = PIN_SIZE / ICON_SIZE;
export const PIN_WIDTH = PIN_SIZE;
export const PIN_HEIGHT = PIN_SIZE;
/** The tail tip inside the pin's box, in CSS pixels from its top-left corner. */
export const PIN_TIP: Point = {
  x: ICON_TIP.x * PIN_SCALE,
  y: ICON_TIP.y * PIN_SCALE,
};

/** Where the pin's top-left corner goes so its tail tip lands on `anchor`. */
export function pinOrigin(anchor: Point): Point {
  return { x: anchor.x - PIN_TIP.x, y: anchor.y - PIN_TIP.y };
}

/** The anchor a pin whose top-left corner is at `origin` points at. */
export function pinAnchor(origin: Point): Point {
  return { x: origin.x + PIN_TIP.x, y: origin.y + PIN_TIP.y };
}

/** The cursor image is the glyph with this much room around it for its halo. */
const CURSOR_MARGIN = 3;
export const CURSOR_SIZE = ICON_SIZE + 2 * CURSOR_MARGIN;
/** The cursor's hotspot: the tail tip, to the nearest pixel (the image is 1:1). */
export const CURSOR_HOTSPOT: Point = {
  x: Math.round(ICON_TIP.x + CURSOR_MARGIN),
  y: Math.round(ICON_TIP.y + CURSOR_MARGIN),
};

/**
 * The `cursor` value for comment mode: the glyph with a white fill, an accent
 * stroke and a white halo (so it reads on white and on dark artifacts), the
 * hotspot on the tail tip, and `crosshair` where cursor images are unsupported.
 */
export function commentCursor(accent: string): string {
  const path = `<path d='${ICON_PATH}'`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${String(CURSOR_SIZE)}' height='${String(CURSOR_SIZE)}' viewBox='${String(-CURSOR_MARGIN)} ${String(-CURSOR_MARGIN)} ${String(CURSOR_SIZE)} ${String(CURSOR_SIZE)}'>` +
    `${path} fill='none' stroke='#fff' stroke-opacity='.85' stroke-width='5' stroke-linejoin='round' stroke-linecap='round'/>` +
    `${path} fill='#fff' stroke='${accent}' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'/>` +
    "</svg>";
  const encoded = svg
    .replaceAll("#", "%23")
    .replaceAll("<", "%3C")
    .replaceAll(">", "%3E");
  return `url("data:image/svg+xml,${encoded}") ${String(CURSOR_HOTSPOT.x)} ${String(CURSOR_HOTSPOT.y)}, crosshair`;
}

/** The accent used for the cursor: the app's light-theme accent, which the white halo keeps legible anywhere. */
export const CURSOR_ACCENT = "#176b4d";

/** Makes comment mode's cursor available to the stylesheets as `--ar-comment-cursor`. */
export function installCommentCursor(
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--ar-comment-cursor", commentCursor(CURSOR_ACCENT));
}
