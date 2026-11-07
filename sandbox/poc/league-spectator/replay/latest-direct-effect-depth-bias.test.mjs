import { expect, test } from "bun:test";
import {
  compileDirectDepthBiasProgram as compile,
  validateDirectDepthBiasProgram as validate,
  assertDirectDepthBiasRenderer,
} from "./latest-direct-effect-depth-bias.mjs";

test("approved raster factors reject reversed or unavailable live renderer depth state", () => {
  expect(() =>
    assertDirectDepthBiasRenderer({
      capabilities: { reversedDepthBuffer: false },
      state: { buffers: { depth: { getReversed: () => false } } },
    }),
  ).not.toThrow();
  for (const renderer of [
    {},
    {
      capabilities: { reversedDepthBuffer: true },
      state: { buffers: { depth: { getReversed: () => false } } },
    },
    {
      capabilities: { reversedDepthBuffer: false },
      state: { buffers: { depth: { getReversed: () => true } } },
    },
  ])
    expect(() => assertDirectDepthBiasRenderer(renderer)).toThrow(
      "non-reversed renderer depth",
    );
});
test("original depth factors retain slope/constant order and normalize only the disabled zero pair", () => {
  const source = { depthBiasFactors: [-1, -60] },
    program = compile(source, "camera-quad");
  expect(program).toMatchObject({ enabled: true, slope: -1, constant: -60 });
  expect(
    validate(
      program,
      source,
      "camera-quad",
      "3f0000001d03000000000606070700010f00000000000000000080bf000070c2",
    ),
  ).toEqual(program);
  expect(
    Object.is(compile({ depthBiasFactors: [-0, 0] }, "camera-quad").slope, 0),
  ).toBe(true);
  expect(
    Object.is(compile({ depthBiasFactors: [-0, -1] }, "camera-quad").slope, -0),
  ).toBe(true);
  expect(compile({}, "camera-quad")).toBeNull();
});
test("unsupported primitives, malformed factors, and stale or forged raster programs cannot inherit depth bias admission", () => {
  for (const primitive of [
    "arbitrary-quad",
    "camera-trail",
    "static-mesh",
    "ray",
  ])
    expect(compile({ depthBiasFactors: [-1, -60] }, primitive)).toBeNull();
  for (const depthBiasFactors of [
    undefined,
    null,
    false,
    [-1],
    [-1, -60, 0],
    [NaN, 0],
    [Infinity, 0],
    ["-1", 0],
  ])
    expect(compile({ depthBiasFactors }, "camera-quad")).toBeNull();
  const source = { depthBiasFactors: [-1, -60] },
    program = compile(source, "camera-quad");
  for (const altered of [
    { ...program, slope: 1 },
    { ...program, enabled: false },
    { ...program, extra: 0 },
    Object.assign(Object.create({ policy: program.policy }), program),
  ])
    expect(() => validate(altered, source, "camera-quad")).toThrow();
  expect(() =>
    validate(program, { depthBiasFactors: [-1, -12] }, "camera-quad"),
  ).toThrow("differs from source");
  expect(() =>
    validate(
      program,
      source,
      "camera-quad",
      "3f0000001503000000000606070700010f000000000000000000000000000000",
    ),
  ).toThrow("native depth bias differs");
  let called = false;
  const accessor = { ...program };
  Object.defineProperty(accessor, "slope", {
    get() {
      called = true;
      return -1;
    },
    enumerable: true,
  });
  expect(() => validate(accessor, source, "camera-quad")).toThrow();
  expect(called).toBe(false);
});
