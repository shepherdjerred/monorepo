import { expect, test } from "bun:test";
import { directSoftDepthConversion } from "./latest-direct-soft-depth.mjs";

test("camera conversion requires supplied finite floats rather than projection defaults", () => {
  for (const pair of [
    undefined,
    null,
    [],
    [1],
    [1, 2, 3],
    [, 2],
    [1, Infinity],
    [NaN, 2],
    [1e100, 2],
    ["1", 2],
  ])
    expect(() => directSoftDepthConversion(pair)).toThrow(
      "Explicit dense finite camera float pair",
    );
});

test("conversion owns its float32 result and preserves a reversed supplied pair", () => {
  const pair = Float32Array.of(1000, 0.1),
    original = [...pair];
  const result = directSoftDepthConversion(pair);
  expect(result).toBeInstanceOf(Float32Array);
  expect(result[1]).toBeGreaterThan(0);
  expect([...pair]).toEqual(original);
  result.fill(0);
  expect(directSoftDepthConversion(pair)[1]).toBeGreaterThan(0);
});
