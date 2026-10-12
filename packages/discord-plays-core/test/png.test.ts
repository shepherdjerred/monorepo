import { describe, expect, it } from "vitest";
import { encodePng, encodePngToSize } from "#src/image/png.ts";
import { decodePng, pngRow, rgbaFromRgb } from "#src/image/png-decode.ts";

describe("encodePngToSize", () => {
  it("throws a RangeError when the rgba buffer is smaller than width*height*4", () => {
    // 2x2 frame requires 16 bytes; supply only 12.
    const tooSmall = Buffer.alloc(12);
    expect(() =>
      encodePngToSize(
        { rgba: tooSmall, width: 2, height: 2 },
        { width: 2, height: 2 },
      ),
    ).toThrow(RangeError);
  });

  it("throws with a descriptive message naming expected vs actual size", () => {
    const tooSmall = Buffer.alloc(4);
    expect(() =>
      encodePngToSize(
        { rgba: tooSmall, width: 2, height: 1 },
        { width: 2, height: 1 },
      ),
    ).toThrow(/need 8 bytes for 2x1 \(got 4\)/);
  });

  it("accepts a buffer exactly the right size", () => {
    // 1x1 frame: exactly 4 bytes needed. Should not throw.
    const exact = Buffer.alloc(4);
    expect(() =>
      encodePngToSize(
        { rgba: exact, width: 1, height: 1 },
        { width: 1, height: 1 },
      ),
    ).not.toThrow();
  });
});

describe("encodePng", () => {
  it("emits RGB (colour type 2) with no alpha channel", () => {
    const png = encodePng(rgbaFromRgb([[10, 20, 30]]), 1, 1);
    const { colourType, bitDepth, width, height } = decodePng(png);
    expect(colourType).toBe(2);
    expect(bitDepth).toBe(8);
    expect(width).toBe(1);
    expect(height).toBe(1);
  });

  it("writes RGBA source bytes to RGB output verbatim (colours unchanged)", () => {
    // red, green, blue, white as a 4x1 frame.
    const png = encodePng(
      rgbaFromRgb([
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 255],
      ]),
      4,
      1,
    );
    const { rows } = decodePng(png);
    expect([...pngRow(rows, 0)]).toEqual([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255,
    ]);
  });

  it("drops the dead alpha byte so opaque output never goes transparent", () => {
    // Even with alpha=0 in the source, the encoded PNG has no alpha samples.
    const png = encodePng(rgbaFromRgb([[123, 45, 67]]), 1, 1);
    const { rows, colourType } = decodePng(png);
    expect(colourType).toBe(2);
    expect([...pngRow(rows, 0)]).toEqual([123, 45, 67]);
  });

  it("nearest-neighbour upscales by the integer scale factor", () => {
    const png = encodePng(
      rgbaFromRgb([
        [255, 0, 0],
        [0, 0, 255],
      ]),
      2,
      1,
      2,
    );
    const { width, height, rows } = decodePng(png);
    expect(width).toBe(4);
    expect(height).toBe(2);
    // Each source pixel becomes a 2x2 block; both rows identical.
    const expected = [255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255];
    expect([...pngRow(rows, 0)]).toEqual(expected);
    expect([...pngRow(rows, 1)]).toEqual(expected);
  });

  it("nearest-neighbour resizes to an explicit output size", () => {
    const png = encodePngToSize(
      {
        rgba: rgbaFromRgb([
          [255, 0, 0],
          [0, 0, 255],
        ]),
        width: 2,
        height: 1,
      },
      { width: 2, height: 3 },
    );
    const { width, height, rows } = decodePng(png);
    expect(width).toBe(2);
    expect(height).toBe(3);
    const expected = [255, 0, 0, 0, 0, 255];
    expect([...pngRow(rows, 0)]).toEqual(expected);
    expect([...pngRow(rows, 1)]).toEqual(expected);
    expect([...pngRow(rows, 2)]).toEqual(expected);
  });
});
