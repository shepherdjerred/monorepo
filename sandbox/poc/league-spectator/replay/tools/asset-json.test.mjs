import { expect, test } from "bun:test";
import { stringifyAssetJson } from "./asset-json.mjs";

test("installed float32 values round-trip with every zero sign and subnormal intact", () => {
  const bits = new Uint32Array([
    0, 0x80000000, 1, 0x80000001, 0x7f7fffff, 0xff7fffff, 0x3f800000,
    0xbf800000,
  ]);
  const values = [...new Float32Array(bits.buffer)];
  const text = stringifyAssetJson({ values });
  const parsed = JSON.parse(text);
  expect(text).toContain("-0.0");
  expect(new Uint32Array(new Float32Array(parsed.values).buffer)).toEqual(bits);
  expect(Object.is(parsed.values[0], 0)).toBe(true);
  expect(Object.is(parsed.values[1], -0)).toBe(true);
});

test("nested asset curves preserve numeric signs without rewriting text or hashes", () => {
  const value = {
    shape: { constantValue: [-0, 1, -2], dynamics: { values: [[0, -0, 3]] } },
    text: "-0.0 literal 80000000",
    hash: "80000000",
  };
  const parsed = JSON.parse(stringifyAssetJson(value, 2));
  expect(Object.is(parsed.shape.constantValue[0], -0)).toBe(true);
  expect(Object.is(parsed.shape.dynamics.values[0][1], -0)).toBe(true);
  expect(parsed.text).toBe(value.text);
  expect(parsed.hash).toBe(value.hash);
  const ordinary = { values: [0, 1, -2], text: "plain" };
  expect(stringifyAssetJson(ordinary)).toBe(JSON.stringify(ordinary));
});

test("non-finite asset values fail before they can become null", () => {
  for (const value of [NaN, Infinity, -Infinity])
    expect(() => stringifyAssetJson({ value })).toThrow("finite numeric");
});
