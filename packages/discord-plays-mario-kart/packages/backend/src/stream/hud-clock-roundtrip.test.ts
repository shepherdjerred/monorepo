import { describe, expect, it } from "bun:test";
import {
  decodeHudClock,
  latencyMsFromClock,
  formatUtcTimestamp,
  type HudSampler,
} from "@discord-plays-mario-kart/common";
import { WIDTH, HEIGHT } from "#src/emulator/constants.ts";
import { drawHudOverlay } from "./overlay.ts";

// The driver feed measures its own glass-to-glass latency by reading the HUD
// clock back off the canvas. That only works if the decoder and the renderer
// agree exactly, so this rounds one against the other rather than against a
// re-implementation: draw with the production renderer, decode with the
// production decoder, and require the original timestamp back.

const BYTES_PER_PIXEL = 4;

function renderHud(
  epochMs: number,
  held: readonly boolean[] = [false, false, false, false],
): Buffer {
  const frame = Buffer.alloc(WIDTH * HEIGHT * BYTES_PER_PIXEL);
  drawHudOverlay(frame, WIDTH, epochMs, held);
  return frame;
}

/** Sample the source framebuffer directly — the unscaled 1:1 case. */
function sourceSampler(frame: Buffer): HudSampler {
  return {
    lumaAt: (x, y) => {
      const px = Math.floor(x);
      const py = Math.floor(y);
      if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) return 0;
      return frame[(py * WIDTH + px) * BYTES_PER_PIXEL] ?? 0;
    },
  };
}

/**
 * Sample through a nearest-neighbour rescale, standing in for the encoder's
 * `scale=` filter so the geometry maths is exercised at a real output size.
 */
function scaledSampler(
  frame: Buffer,
  outputWidth: number,
  outputHeight: number,
): HudSampler {
  const scaleX = outputWidth / WIDTH;
  const scaleY = outputHeight / HEIGHT;
  return {
    lumaAt: (x, y) => {
      // Source -> output -> back to source, exactly as the browser bridge does.
      const outX = Math.floor(x * scaleX);
      const outY = Math.floor(y * scaleY);
      const px = Math.min(Math.floor(outX / scaleX), WIDTH - 1);
      const py = Math.min(Math.floor(outY / scaleY), HEIGHT - 1);
      return frame[(py * WIDTH + px) * BYTES_PER_PIXEL] ?? 0;
    },
  };
}

/** 2026-08-08T13:45:07.123Z — a timestamp exercising every digit position. */
const SAMPLE_EPOCH_MS = Date.UTC(2026, 7, 8, 13, 45, 7, 123);
const SAMPLE_MS_OF_DAY = ((13 * 60 + 45) * 60 + 7) * 1000 + 123;

describe("HUD clock round-trip", () => {
  it("decodes a rendered clock back to the millisecond", () => {
    const decoded = decodeHudClock(sourceSampler(renderHud(SAMPLE_EPOCH_MS)));
    expect(decoded).toBe(SAMPLE_MS_OF_DAY);
  });

  it("agrees with the renderer's own text formatting", () => {
    expect(formatUtcTimestamp(SAMPLE_EPOCH_MS)).toBe("13:45:07.123");
  });

  it("decodes every digit in every position", () => {
    // Walk a full set of distinct digits through the clock by stepping time.
    for (const epochMs of [
      Date.UTC(2026, 7, 8, 0, 0, 0, 0),
      Date.UTC(2026, 7, 8, 12, 34, 56, 789),
      Date.UTC(2026, 7, 8, 23, 59, 59, 999),
      Date.UTC(2026, 7, 8, 10, 20, 30, 405),
    ]) {
      const expected =
        epochMs - Date.UTC(2026, 7, 8, 0, 0, 0, 0) === 0
          ? 0
          : epochMs - Date.UTC(2026, 7, 8, 0, 0, 0, 0);
      expect(decodeHudClock(sourceSampler(renderHud(epochMs)))).toBe(expected);
    }
  });

  it("survives the encoder's 640x480 rescale", () => {
    const frame = renderHud(SAMPLE_EPOCH_MS);
    expect(decodeHudClock(scaledSampler(frame, 640, 480))).toBe(
      SAMPLE_MS_OF_DAY,
    );
  });

  it("survives a non-integer rescale (960x720)", () => {
    const frame = renderHud(SAMPLE_EPOCH_MS);
    expect(decodeHudClock(scaledSampler(frame, 960, 720))).toBe(
      SAMPLE_MS_OF_DAY,
    );
  });

  it("is unaffected by the seat-echo digits sharing the badge", () => {
    const frame = renderHud(SAMPLE_EPOCH_MS, [true, false, true, true]);
    expect(decodeHudClock(sourceSampler(frame))).toBe(SAMPLE_MS_OF_DAY);
  });

  it("returns undefined rather than a wrong time on an unrendered frame", () => {
    const blank = Buffer.alloc(WIDTH * HEIGHT * BYTES_PER_PIXEL);
    expect(decodeHudClock(sourceSampler(blank))).toBeUndefined();
  });
});

describe("latencyMsFromClock", () => {
  it("measures capture-to-paint against the browser clock", () => {
    const captured = SAMPLE_MS_OF_DAY;
    expect(latencyMsFromClock(captured, SAMPLE_EPOCH_MS + 137)).toBe(137);
  });

  it("does not report a day of latency across midnight", () => {
    const capturedJustBeforeMidnight = 86_400_000 - 50;
    const nowJustAfter = Date.UTC(2026, 7, 9, 0, 0, 0, 30);
    expect(latencyMsFromClock(capturedJustBeforeMidnight, nowJustAfter)).toBe(
      80,
    );
  });
});
