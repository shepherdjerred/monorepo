// The stream HUD's 5x7 bitmap font and its layout geometry.
//
// Shared because two sides need to agree on it exactly: the backend *draws* the
// HUD into every frame, and the driver-feed client *reads it back* off its own
// canvas to measure glass-to-glass latency. A duplicated glyph table would drift
// silently — the decode would start mis-reading digits with nothing failing.
//
// Rendering lives in the backend (`stream/overlay.ts`); only the font and the
// geometry needed to locate a dot live here.

/** Blank 5x7 glyph, also the fallback for characters outside the font. */
export const HUD_SPACE_GLYPH: readonly number[] = [
  0b0_0000, 0b0_0000, 0b0_0000, 0b0_0000, 0b0_0000, 0b0_0000, 0b0_0000,
];

/** 5x7 bitmap glyphs; 7 rows, bit 4 = leftmost column. Classic HD44780 shapes. */
export const HUD_GLYPHS = new Map<string, readonly number[]>([
  ["0", [0b0_1110, 0b1_0001, 0b1_0011, 0b1_0101, 0b1_1001, 0b1_0001, 0b0_1110]],
  ["1", [0b0_0100, 0b0_1100, 0b0_0100, 0b0_0100, 0b0_0100, 0b0_0100, 0b0_1110]],
  ["2", [0b0_1110, 0b1_0001, 0b0_0001, 0b0_0010, 0b0_0100, 0b0_1000, 0b1_1111]],
  ["3", [0b1_1111, 0b0_0010, 0b0_0100, 0b0_0010, 0b0_0001, 0b1_0001, 0b0_1110]],
  ["4", [0b0_0010, 0b0_0110, 0b0_1010, 0b1_0010, 0b1_1111, 0b0_0010, 0b0_0010]],
  ["5", [0b1_1111, 0b1_0000, 0b1_1110, 0b0_0001, 0b0_0001, 0b1_0001, 0b0_1110]],
  ["6", [0b0_0110, 0b0_1000, 0b1_0000, 0b1_1110, 0b1_0001, 0b1_0001, 0b0_1110]],
  ["7", [0b1_1111, 0b0_0001, 0b0_0010, 0b0_0100, 0b0_1000, 0b0_1000, 0b0_1000]],
  ["8", [0b0_1110, 0b1_0001, 0b1_0001, 0b0_1110, 0b1_0001, 0b1_0001, 0b0_1110]],
  ["9", [0b0_1110, 0b1_0001, 0b1_0001, 0b0_1111, 0b0_0001, 0b0_0010, 0b0_1100]],
  [":", [0b0_0000, 0b0_1100, 0b0_1100, 0b0_0000, 0b0_1100, 0b0_1100, 0b0_0000]],
  [".", [0b0_0000, 0b0_0000, 0b0_0000, 0b0_0000, 0b0_0000, 0b0_1100, 0b0_1100]],
]);

export const HUD_GLYPH_COLS = 5;
export const HUD_GLYPH_ROWS = 7;
/** One blank column between glyphs. */
export const HUD_CELL_COLS = HUD_GLYPH_COLS + 1;
/**
 * Glyph cell scale, in source-framebuffer pixels. 2:1 keeps each dot square once
 * the anamorphic 640x240 framebuffer is displayed at 4:3. At the prior 4:2 the
 * HUD was a banner covering ~84% of the frame width; 2:1 lands it at ~17%.
 */
export const HUD_GLYPH_SCALE_X = 2;
export const HUD_GLYPH_SCALE_Y = 1;
export const HUD_PAD_X = 2;
export const HUD_PAD_Y = 1;
export const HUD_MARGIN_X = 8;
export const HUD_MARGIN_Y = 4;

/** The clock's character count, `HH:MM:SS.mmm`. */
export const HUD_CLOCK_LENGTH = 12;

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
