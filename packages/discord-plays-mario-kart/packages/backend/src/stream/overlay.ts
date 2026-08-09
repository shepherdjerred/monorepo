// Wall-clock timestamp overlay for the Go-Live stream (and the `/screenshot`
// artifact, which now goes through the same overlay pipeline). Every frame is
// stamped with the UTC time it was captured from the emulator, so comparing
// the on-screen clock against a real clock (`date -u`) reads the Discord
// viewer delay directly off the stream. Dependency-free, drawn straight into
// the BGRA frame copy (overlays write greyscale — channel order is irrelevant,
// so this is safe on the screenshot's RGBX buffer too).
//
// The framebuffer is a horizontally-doubled 320x240 (see constants.ts), so
// glyphs are drawn twice as wide as tall (GLYPH_SCALE_X = 2 * GLYPH_SCALE_Y)
// to come out square once the 640x240 frame is displayed at 4:3.
//
// The font and geometry live in `@discord-plays-mario-kart/common` because the
// driver-feed client reads this HUD back off its own canvas to measure
// glass-to-glass latency; both sides must agree on it exactly.

import {
  HUD_GLYPHS,
  HUD_SPACE_GLYPH,
  HUD_GLYPH_COLS,
  HUD_GLYPH_ROWS,
  HUD_CELL_COLS,
  HUD_GLYPH_SCALE_X,
  HUD_GLYPH_SCALE_Y,
  HUD_PAD_X,
  HUD_PAD_Y,
  HUD_MARGIN_X,
  HUD_MARGIN_Y,
  formatUtcTimestamp,
} from "@discord-plays-mario-kart/common";

const GLYPHS = HUD_GLYPHS;
const SPACE_GLYPH = HUD_SPACE_GLYPH;
const GLYPH_COLS = HUD_GLYPH_COLS;
const GLYPH_ROWS = HUD_GLYPH_ROWS;
const CELL_COLS = HUD_CELL_COLS;
const GLYPH_SCALE_X = HUD_GLYPH_SCALE_X;
const GLYPH_SCALE_Y = HUD_GLYPH_SCALE_Y;
const PAD_X = HUD_PAD_X;
const PAD_Y = HUD_PAD_Y;
const MARGIN_X = HUD_MARGIN_X;
const MARGIN_Y = HUD_MARGIN_Y;
const BYTES_PER_PIXEL = 4;

function writePixel(frame: Buffer, offset: number, value: number): void {
  frame[offset] = value;
  frame[offset + 1] = value;
  frame[offset + 2] = value;
  // The 4th byte is dead XRGB padding (dropped by ffmpeg's bgra->yuv420p
  // conversion); set it anyway so the overlay region is fully defined.
  frame[offset + 3] = 0xff;
}

/**
 * Draws `text` as white-on-black at the frame's top-left. Mutates `frame`
 * (BGRA, `width` pixels per row; height derived from the buffer length).
 * Anything that falls outside the buffer is clipped, never thrown — a frame
 * from an unexpected VI mode must not take the stream down.
 */
export function drawTextOverlay(
  frame: Buffer,
  width: number,
  text: string,
): void {
  const frameHeight = Math.floor(frame.length / (width * BYTES_PER_PIXEL));
  const boxWidth = 2 * PAD_X + text.length * CELL_COLS * GLYPH_SCALE_X;
  const boxHeight = 2 * PAD_Y + GLYPH_ROWS * GLYPH_SCALE_Y;
  const xEnd = Math.min(MARGIN_X + boxWidth, width);
  const yEnd = Math.min(MARGIN_Y + boxHeight, frameHeight);

  for (let y = MARGIN_Y; y < yEnd; y++) {
    const rowBase = y * width * BYTES_PER_PIXEL;
    for (let x = MARGIN_X; x < xEnd; x++) {
      writePixel(frame, rowBase + x * BYTES_PER_PIXEL, 0x00);
    }
  }

  const target: FrameTarget = { frame, width, height: frameHeight };
  let i = 0;
  for (const ch of text) {
    const glyph = GLYPHS.get(ch) ?? SPACE_GLYPH;
    const cellLeft = MARGIN_X + PAD_X + i * CELL_COLS * GLYPH_SCALE_X;
    drawGlyph(target, glyph, cellLeft);
    i++;
  }
}

type FrameTarget = {
  frame: Buffer;
  width: number;
  height: number;
};

function drawGlyph(
  target: FrameTarget,
  glyph: readonly number[],
  cellLeft: number,
): void {
  for (let row = 0; row < GLYPH_ROWS; row++) {
    const bits = glyph[row] ?? 0;
    for (let col = 0; col < GLYPH_COLS; col++) {
      if ((bits & (1 << (GLYPH_COLS - 1 - col))) === 0) continue;
      drawDot(
        target,
        cellLeft + col * GLYPH_SCALE_X,
        MARGIN_Y + PAD_Y + row * GLYPH_SCALE_Y,
      );
    }
  }
}

// One font pixel, scaled to a GLYPH_SCALE_X x GLYPH_SCALE_Y block.
function drawDot(target: FrameTarget, left: number, top: number): void {
  for (let sy = 0; sy < GLYPH_SCALE_Y; sy++) {
    const y = top + sy;
    if (y >= target.height) continue;
    const rowBase = y * target.width * BYTES_PER_PIXEL;
    for (let sx = 0; sx < GLYPH_SCALE_X; sx++) {
      const x = left + sx;
      if (x >= target.width) continue;
      writePixel(target.frame, rowBase + x * BYTES_PER_PIXEL, 0xff);
    }
  }
}

/** Stamps the capture-time UTC wall clock onto a stream frame. */
export function drawTimestampOverlay(
  frame: Buffer,
  width: number,
  epochMs: number,
): void {
  drawTextOverlay(frame, width, formatUtcTimestamp(epochMs));
}

/**
 * Per-seat input-echo flags: the seat digit while that player holds any
 * control, `.` while idle — e.g. `[true,false,false,true]` → `"1..4"`. Lets a
 * screen recording of the Discord stream measure press→glass latency: the
 * digit lights the frame the input was applied.
 */
export function formatSeatFlags(held: readonly boolean[]): string {
  return held.map((h, i) => (h ? String(i + 1) : ".")).join("");
}

/** The full stream HUD: capture-time UTC clock + per-seat input echo. */
export function drawHudOverlay(
  frame: Buffer,
  width: number,
  epochMs: number,
  held: readonly boolean[],
): void {
  drawTextOverlay(
    frame,
    width,
    `${formatUtcTimestamp(epochMs)} ${formatSeatFlags(held)}`,
  );
}
