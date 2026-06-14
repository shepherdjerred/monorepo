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

// Blank 5x7 glyph, also the fallback for characters outside the font.
const SPACE_GLYPH: readonly number[] = [
  0b0_0000, 0b0_0000, 0b0_0000, 0b0_0000, 0b0_0000, 0b0_0000, 0b0_0000,
];

// 5x7 bitmap glyphs; 7 rows, bit 4 = leftmost column. Classic HD44780 shapes.
const GLYPHS = new Map<string, readonly number[]>([
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

const GLYPH_COLS = 5;
const GLYPH_ROWS = 7;
// One blank column between glyphs.
const CELL_COLS = GLYPH_COLS + 1;
// Glyph cell scale: 2:1 keeps each dot square once the 640x240 framebuffer is
// displayed at 4:3. At the prior 4:2 the HUD was a banner covering ~84% of the
// frame width; 2:1 lands it at ~17% — a small top-left corner badge.
const GLYPH_SCALE_X = 2;
const GLYPH_SCALE_Y = 1;
const PAD_X = 2;
const PAD_Y = 1;
const MARGIN_X = 8;
const MARGIN_Y = 4;
const BYTES_PER_PIXEL = 4;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "HH:MM:SS.mmm" (UTC) for an epoch-milliseconds value. The "UTC " prefix and
 *  its glyphs were dropped to shrink the HUD badge — the timestamp is still
 *  UTC, the colon-separated `HH:MM:SS.mmm` makes it self-evidently a clock. */
export function formatUtcTimestamp(epochMs: number): string {
  const d = new Date(epochMs);
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.${ms}`;
}

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
