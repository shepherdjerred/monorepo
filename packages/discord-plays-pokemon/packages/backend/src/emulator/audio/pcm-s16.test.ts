import { describe, expect, test } from "vitest";
import { float32ToS16le } from "./pcm-s16.ts";

function f32(values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 4);
  for (const [index, value] of values.entries()) {
    buffer.writeFloatLE(value, index * 4);
  }
  return buffer;
}

describe("float32ToS16le", () => {
  test("scales full range and keeps silence silent", () => {
    const out = float32ToS16le(f32([0, 1, -1, 0.5]));
    expect([0, 1, 2, 3].map((index) => out.readInt16LE(index * 2))).toEqual([
      0, 32_767, -32_767, 16_384,
    ]);
  });

  test("clips samples outside [-1, 1] instead of wrapping", () => {
    const out = float32ToS16le(f32([2, -3]));
    expect([out.readInt16LE(0), out.readInt16LE(2)]).toEqual([32_767, -32_767]);
  });
});
