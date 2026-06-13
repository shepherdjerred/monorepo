import { describe, expect, test } from "bun:test";
import { blitBgra } from "./blit.ts";
import type { FrameView, Label } from "./blit.ts";

function solidLabel(
  w: number,
  h: number,
  [b, g, r]: [number, number, number],
): Label {
  const bgra = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    bgra[i * 4] = b;
    bgra[i * 4 + 1] = g;
    bgra[i * 4 + 2] = r;
    bgra[i * 4 + 3] = 255;
  }
  return { bgra, width: w, height: h };
}

function px(frame: Buffer, w: number, x: number, y: number): number[] {
  const i = (y * w + x) * 4;
  return [
    frame[i] ?? -1,
    frame[i + 1] ?? -1,
    frame[i + 2] ?? -1,
    frame[i + 3] ?? -1,
  ];
}

function view(data: Buffer, width: number, height: number): FrameView {
  return { data, width, height };
}

describe("blitBgra", () => {
  test("opaque label overwrites destination at the offset", () => {
    const frame = Buffer.alloc(4 * 4 * 4); // 4x4 BGRA, all zero
    blitBgra(view(frame, 4, 4), solidLabel(2, 2, [10, 20, 30]), 1, 1);
    expect(px(frame, 4, 0, 0)).toEqual([0, 0, 0, 0]); // untouched
    expect(px(frame, 4, 1, 1)).toEqual([10, 20, 30, 255]);
    expect(px(frame, 4, 2, 2)).toEqual([10, 20, 30, 255]);
    expect(px(frame, 4, 3, 3)).toEqual([0, 0, 0, 0]); // outside 2x2
  });

  test("clips at the right/bottom edge without overflow", () => {
    const frame = Buffer.alloc(4 * 4 * 4);
    // Place a 3x3 label so it spills past the 4x4 frame.
    blitBgra(view(frame, 4, 4), solidLabel(3, 3, [1, 2, 3]), 3, 3);
    expect(px(frame, 4, 3, 3)).toEqual([1, 2, 3, 255]); // only the in-bounds px
    // Nothing wrote out of bounds (buffer length unchanged, last px intact).
    expect(frame.length).toBe(4 * 4 * 4);
  });

  test("negative offset clips the top-left", () => {
    const frame = Buffer.alloc(4 * 4 * 4);
    blitBgra(view(frame, 4, 4), solidLabel(2, 2, [9, 9, 9]), -1, -1);
    expect(px(frame, 4, 0, 0)).toEqual([9, 9, 9, 255]); // the one visible px
    expect(px(frame, 4, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  test("premultiplied 50% alpha blends over the destination", () => {
    const frame = Buffer.alloc(1 * 1 * 4);
    frame[0] = 200;
    frame[1] = 200;
    frame[2] = 200;
    frame[3] = 255;
    // Premultiplied white at ~50%: colour already * alpha (128), alpha 128.
    const label: Label = {
      bgra: Buffer.from([128, 128, 128, 128]),
      width: 1,
      height: 1,
    };
    blitBgra(view(frame, 1, 1), label, 0, 0);
    // out = 128 + 200 * (127 >> 8) -> 128 + floor(200*127/256) = 128 + 99 = 227
    expect(frame[0]).toBe(227);
    expect(frame[1]).toBe(227);
    expect(frame[2]).toBe(227);
  });

  test("fully transparent label leaves the frame untouched", () => {
    const frame = Buffer.from([50, 60, 70, 255]);
    const label: Label = {
      bgra: Buffer.from([0, 0, 0, 0]),
      width: 1,
      height: 1,
    };
    blitBgra(view(frame, 1, 1), label, 0, 0);
    expect([...frame]).toEqual([50, 60, 70, 255]);
  });

  test("entirely-off-frame label is a no-op", () => {
    const frame = Buffer.alloc(2 * 2 * 4);
    blitBgra(view(frame, 2, 2), solidLabel(2, 2, [1, 1, 1]), 5, 5);
    expect([...frame]).toEqual([...Buffer.alloc(16)]);
  });
});
