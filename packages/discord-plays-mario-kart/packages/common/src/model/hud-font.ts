// Canonical stream-HUD bitmap data and geometry.
//
// The language-neutral JSON catalog is the source of truth. This module
// validates it at load time and exposes the existing TypeScript API to the
// backend renderer and browser-side latency reader.

import { z } from "zod";
import hudFontJson from "./hud-font.json" with { type: "json" };

const GlyphSchema = z.array(z.number().int().min(0).max(0b1_1111)).length(7);
const GlyphNameSchema = z.enum([
  " ",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  ":",
  ".",
]);
const HudFontCatalogSchema = z.strictObject({
  $schema: z.literal("./hud-font.schema.json"),
  glyphs: z.record(GlyphNameSchema, GlyphSchema),
  geometry: z.strictObject({
    glyphCols: z.number().int().positive(),
    glyphRows: z.number().int().positive(),
    glyphScaleX: z.number().int().positive(),
    glyphScaleY: z.number().int().positive(),
    padX: z.number().int().nonnegative(),
    padY: z.number().int().nonnegative(),
    marginX: z.number().int().nonnegative(),
    marginY: z.number().int().nonnegative(),
    clockLength: z.number().int().positive(),
  }),
});

const catalog = HudFontCatalogSchema.parse(hudFontJson);

/** Blank 5x7 glyph, also the fallback for characters outside the font. */
export const HUD_SPACE_GLYPH: readonly number[] = catalog.glyphs[" "];

/** 5x7 bitmap glyphs; 7 rows, bit 4 = leftmost column. */
export const HUD_GLYPHS = new Map<string, readonly number[]>(
  Object.entries(catalog.glyphs).filter(([character]) => character !== " "),
);

export const HUD_GLYPH_COLS = catalog.geometry.glyphCols;
export const HUD_GLYPH_ROWS = catalog.geometry.glyphRows;
/** One blank column between glyphs. */
export const HUD_CELL_COLS = HUD_GLYPH_COLS + 1;
/**
 * Glyph cell scale, in source-framebuffer pixels. 2:1 keeps each dot square once
 * the anamorphic 640x240 framebuffer is displayed at 4:3. At the prior 4:2 the
 * HUD was a banner covering ~84% of the frame width; 2:1 lands it at ~17%.
 */
export const HUD_GLYPH_SCALE_X = catalog.geometry.glyphScaleX;
export const HUD_GLYPH_SCALE_Y = catalog.geometry.glyphScaleY;
export const HUD_PAD_X = catalog.geometry.padX;
export const HUD_PAD_Y = catalog.geometry.padY;
export const HUD_MARGIN_X = catalog.geometry.marginX;
export const HUD_MARGIN_Y = catalog.geometry.marginY;

/** The clock's character count, `HH:MM:SS.mmm`. */
export const HUD_CLOCK_LENGTH = catalog.geometry.clockLength;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * "HH:MM:SS.mmm" (UTC) for an epoch-milliseconds value. The "UTC " prefix and
 * its glyphs were dropped to shrink the HUD badge — the timestamp is still UTC,
 * and the colon-separated form makes it self-evidently a clock.
 */
export function formatUtcTimestamp(epochMs: number): string {
  const at = new Date(epochMs);
  const ms = String(at.getUTCMilliseconds()).padStart(3, "0");
  return `${pad2(at.getUTCHours())}:${pad2(at.getUTCMinutes())}:${pad2(at.getUTCSeconds())}.${ms}`;
}

/**
 * Parse "HH:MM:SS.mmm" back to milliseconds since UTC midnight, or undefined if
 * it is not a well-formed clock. Used by the driver feed's latency readout to
 * turn decoded glyphs back into a time.
 */
export function parseUtcTimestampMs(text: string): number | undefined {
  const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(text);
  if (match === null) return undefined;
  const [, hours, minutes, seconds, millis] = match;
  if (
    hours === undefined ||
    minutes === undefined ||
    seconds === undefined ||
    millis === undefined
  ) {
    return undefined;
  }
  const h = Number(hours);
  const m = Number(minutes);
  const s = Number(seconds);
  if (h > 23 || m > 59 || s > 59) return undefined;
  return ((h * 60 + m) * 60 + s) * 1000 + Number(millis);
}
