// Read the burned-in HUD clock back off the decoded canvas.
//
// The backend stamps every frame with the UTC wall-clock time it was captured
// from the emulator, and the driver feed's tee sits after that overlay — so the
// pixels this tab just painted carry the exact instant they were produced.
// Subtracting them from the browser's own clock gives capture-to-paint latency
// with no extra protocol, no server cooperation, and no estimation.
//
// This is the same measurement the PinchTab `getStats` rig approximates for the
// Discord path, except here the page can do it to itself, continuously.
//
// Caveat worth stating in the UI: it compares the server's clock to the
// browser's, so it is only meaningful when both are NTP-synced. It also excludes
// the display's own pipeline, so it is capture-to-paint, not photons-to-eye.

import {
  HUD_GLYPHS,
  HUD_GLYPH_COLS,
  HUD_GLYPH_ROWS,
  HUD_CELL_COLS,
  HUD_GLYPH_SCALE_X,
  HUD_GLYPH_SCALE_Y,
  HUD_PAD_X,
  HUD_PAD_Y,
  HUD_MARGIN_X,
  HUD_MARGIN_Y,
  HUD_CLOCK_LENGTH,
  parseUtcTimestampMs,
} from "./hud-font.ts";

/** The framebuffer the overlay is drawn against, before the encoder scales it. */
export const HUD_SOURCE_WIDTH = 640;
export const HUD_SOURCE_HEIGHT = 240;

const MS_PER_DAY = 86_400_000;
const HALF_DAY_MS = MS_PER_DAY / 2;
/** White-on-black badge, so anything past mid-grey is a lit dot. */
const LUMA_THRESHOLD = 128;

/** Reverse glyph lookup, built once: row bitmask tuple -> character. */
const GLYPH_BY_ROWS = new Map<string, string>(
  [...HUD_GLYPHS].map(([character, rows]) => [rows.join(","), character]),
);

/** Source-pixel bounding box of the clock portion of the badge. */
export const HUD_CLOCK_BOX = {
  x: HUD_MARGIN_X,
  y: HUD_MARGIN_Y,
  width:
    HUD_PAD_X +
    HUD_CLOCK_LENGTH * HUD_CELL_COLS * HUD_GLYPH_SCALE_X +
    HUD_PAD_X,
  height: HUD_PAD_Y + HUD_GLYPH_ROWS * HUD_GLYPH_SCALE_Y + HUD_PAD_Y,
} as const;

export type HudSampler = {
  /** Luma at a *source-framebuffer* coordinate, 0-255. */
  readonly lumaAt: (sourceX: number, sourceY: number) => number;
};

/**
 * Decode the 12-character clock into milliseconds since UTC midnight.
 *
 * Returns undefined when any glyph fails to match exactly. That is deliberate:
 * a wrong latency number is worse than a missing one, and a smeared frame is
 * simply skipped — the readout updates several times a second regardless.
 */
export function decodeHudClock(sampler: HudSampler): number | undefined {
  let text = "";
  for (let index = 0; index < HUD_CLOCK_LENGTH; index++) {
    const character = decodeGlyph(sampler, index);
    if (character === undefined) return undefined;
    text += character;
  }
  return parseUtcTimestampMs(text);
}

function decodeGlyph(sampler: HudSampler, index: number): string | undefined {
  const cellLeft =
    HUD_MARGIN_X + HUD_PAD_X + index * HUD_CELL_COLS * HUD_GLYPH_SCALE_X;
  const rows: number[] = [];
  for (let row = 0; row < HUD_GLYPH_ROWS; row++) {
    let bits = 0;
    for (let col = 0; col < HUD_GLYPH_COLS; col++) {
      // Sample the centre of the dot's scaled block; edges blur under the
      // encoder's scaler and lossy compression, centres do not.
      const x = cellLeft + col * HUD_GLYPH_SCALE_X + HUD_GLYPH_SCALE_X / 2;
      const y =
        HUD_MARGIN_Y +
        HUD_PAD_Y +
        row * HUD_GLYPH_SCALE_Y +
        HUD_GLYPH_SCALE_Y / 2;
      if (sampler.lumaAt(x, y) > LUMA_THRESHOLD) {
        bits |= 1 << (HUD_GLYPH_COLS - 1 - col);
      }
    }
    rows.push(bits);
  }
  return GLYPH_BY_ROWS.get(rows.join(","));
}

/**
 * Capture-to-paint latency in ms, from a decoded clock and the browser's clock.
 *
 * Both are UTC times-of-day, so a capture just before midnight seen just after
 * it would otherwise read as a day of negative latency.
 */
export function latencyMsFromClock(
  capturedMsOfDay: number,
  nowEpochMs: number,
): number {
  const nowMsOfDay = nowEpochMs % MS_PER_DAY;
  let delta = nowMsOfDay - capturedMsOfDay;
  if (delta < -HALF_DAY_MS) delta += MS_PER_DAY;
  if (delta > HALF_DAY_MS) delta -= MS_PER_DAY;
  return delta;
}
