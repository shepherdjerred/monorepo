import { describe, expect, it } from "bun:test";
import {
  drawTextOverlay,
  drawTimestampOverlay,
  formatUtcTimestamp,
} from "./overlay.ts";

const WIDTH = 640;
const HEIGHT = 240;
const BYTES_PER_PIXEL = 4;

// Sentinel-filled frame so untouched bytes are detectable.
function makeFrame(width = WIDTH, height = HEIGHT): Buffer {
  return Buffer.alloc(width * height * BYTES_PER_PIXEL, 0xab);
}

function pixelAt(frame: Buffer, width: number, x: number, y: number): Buffer {
  const offset = (y * width + x) * BYTES_PER_PIXEL;
  return frame.subarray(offset, offset + BYTES_PER_PIXEL);
}

describe("formatUtcTimestamp", () => {
  it("formats epoch milliseconds as UTC with millisecond precision", () => {
    // 2026-06-12T07:08:09.045Z
    expect(formatUtcTimestamp(Date.UTC(2026, 5, 12, 7, 8, 9, 45))).toBe(
      "UTC 07:08:09.045",
    );
  });

  it("zero-pads every field", () => {
    expect(formatUtcTimestamp(Date.UTC(2026, 0, 1, 0, 0, 0, 0))).toBe(
      "UTC 00:00:00.000",
    );
  });
});

describe("drawTextOverlay", () => {
  it("writes only pure black and pure white inside the box", () => {
    const frame = makeFrame();
    drawTextOverlay(frame, WIDTH, "UTC 12:34:56.789");

    let white = 0;
    let black = 0;
    for (let i = 0; i < frame.length; i += BYTES_PER_PIXEL) {
      const [b, g, r, a] = [frame[i], frame[i + 1], frame[i + 2], frame[i + 3]];
      if (b === 0xab) {
        expect([b, g, r, a]).toEqual([0xab, 0xab, 0xab, 0xab]);
        continue;
      }
      expect(a).toBe(0xff);
      expect(g).toBe(b);
      expect(r).toBe(b);
      if (b === 0xff) white++;
      else if (b === 0x00) black++;
      else
        throw new Error(
          `unexpected channel value ${String(b)} at ${String(i)}`,
        );
    }
    expect(white).toBeGreaterThan(0);
    expect(black).toBeGreaterThan(white);
  });

  it("leaves pixels outside the overlay box untouched", () => {
    const frame = makeFrame();
    drawTextOverlay(frame, WIDTH, "UTC 12:34:56.789");

    // Bottom half of the frame and the right edge are far outside the box.
    expect(pixelAt(frame, WIDTH, WIDTH - 1, HEIGHT - 1)).toEqual(
      Buffer.from([0xab, 0xab, 0xab, 0xab]),
    );
    expect(pixelAt(frame, WIDTH, 0, HEIGHT / 2)).toEqual(
      Buffer.from([0xab, 0xab, 0xab, 0xab]),
    );
    // Above and left of the margin.
    expect(pixelAt(frame, WIDTH, 0, 0)).toEqual(
      Buffer.from([0xab, 0xab, 0xab, 0xab]),
    );
  });

  it("renders different text to different pixels", () => {
    const a = makeFrame();
    const b = makeFrame();
    drawTextOverlay(a, WIDTH, "UTC 11:11:11.111");
    drawTextOverlay(b, WIDTH, "UTC 22:22:22.222");
    expect(a.equals(b)).toBe(false);
  });

  it("is deterministic for the same text", () => {
    const a = makeFrame();
    const b = makeFrame();
    drawTextOverlay(a, WIDTH, "UTC 12:34:56.789");
    drawTextOverlay(b, WIDTH, "UTC 12:34:56.789");
    expect(a.equals(b)).toBe(true);
  });

  it("clips instead of throwing on a frame shorter than the overlay box", () => {
    const tiny = Buffer.alloc(WIDTH * 3 * BYTES_PER_PIXEL, 0xab);
    expect(() => {
      drawTextOverlay(tiny, WIDTH, "UTC 12:34:56.789");
    }).not.toThrow();
    expect(tiny.length).toBe(WIDTH * 3 * BYTES_PER_PIXEL);
  });
});

describe("drawTimestampOverlay", () => {
  it("draws the formatted timestamp", () => {
    const direct = makeFrame();
    const viaTimestamp = makeFrame();
    const epochMs = Date.UTC(2026, 5, 12, 7, 8, 9, 45);
    drawTextOverlay(direct, WIDTH, formatUtcTimestamp(epochMs));
    drawTimestampOverlay(viaTimestamp, WIDTH, epochMs);
    expect(viaTimestamp.equals(direct)).toBe(true);
  });
});
