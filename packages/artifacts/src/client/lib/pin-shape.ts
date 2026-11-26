/**
 * The comment pin is a speech bubble with its tail pointing at the anchor.
 * The stored anchor is the tail's tip, not the bubble's centre, so everything
 * that positions a pin places the *tip* at the anchor point.
 */
import type { Point } from "./geometry.ts";

export const PIN_WIDTH = 26;
export const PIN_HEIGHT = 30;
/** The tail tip inside the pin's box, in CSS pixels from its top-left corner. */
export const PIN_TIP: Point = { x: 1, y: 30 };

/**
 * The bubble and its tail in a 26 x 30 box. The path ends its tail at
 * `PIN_TIP`; the cursor uses the same outline so the pointer and the pin agree.
 */
export const PIN_PATH =
  "M13 .75C19.9 .75 25.25 5.4 25.25 11C25.25 16.6 19.9 21.25 13 21.25H11L1 30L4.6 20.2C2.2 18.4 .75 15.1 .75 11C.75 5.4 6.1 .75 13 .75Z";

/** Where the pin's top-left corner goes so its tail tip lands on `anchor`. */
export function pinOrigin(anchor: Point): Point {
  return { x: anchor.x - PIN_TIP.x, y: anchor.y - PIN_TIP.y };
}

/** The anchor a pin whose top-left corner is at `origin` points at. */
export function pinAnchor(origin: Point): Point {
  return { x: origin.x + PIN_TIP.x, y: origin.y + PIN_TIP.y };
}
