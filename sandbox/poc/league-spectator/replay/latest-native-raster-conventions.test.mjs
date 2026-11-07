import { test, expect } from "bun:test";
import {
  directNativeMetalRasterToGles,
  DIRECT_NATIVE_RASTER_COORDINATE_POLICY,
} from "./latest-native-raster-conventions.mjs";

const convention = { targetViewportOrigin: "lower-left", clipY: "unchanged" };
function pipeline(raw15, cull = true) {
  const bytes = new Uint8Array(32);
  bytes[4] = cull ? 0x10 : 0;
  bytes[15] = raw15;
  return {
    descriptorHex: bytes.toHex(),
    state: {
      frontFace: raw15 ? 0x0900 : 0x0901,
      cullFace: 0x0405,
      cullEnabled: cull,
      depthMask: false,
      blendFactors: [1, 1, 1, 1],
    },
  };
}

test("preserves native winding intent across opposite window origins", () => {
  for (const raw15 of [0, 1])
    for (const cull of [false, true]) {
      const source = pipeline(raw15, cull),
        before = structuredClone(source),
        result = directNativeMetalRasterToGles(source, convention);
      expect(result.policy).toBe(DIRECT_NATIVE_RASTER_COORDINATE_POLICY);
      expect(result.native.winding).toBe(raw15 ? 0 : 1);
      expect(result.state.frontFace).toBe(raw15 ? 0x0901 : 0x0900);
      expect(result.state.cullEnabled).toBe(cull);
      expect(result.state.cullFace).toBe(0x0405);
      expect(result.state.depthMask).toBe(false);
      expect(source).toEqual(before);
      // Independent signed-area calculation: the Metal positive-height
      // viewport negates NDC Y; a GLES positive-height viewport retains it.
      // A GL_CCW triangle therefore has clockwise Metal framebuffer area.
      const triangle = [
          [-0.5, -0.5],
          [0.5, -0.5],
          [0, 0.5],
        ],
        area = (p) =>
          (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) -
          (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]),
        glArea = area(triangle.map(([x, y]) => [(x + 1) * 640, (y + 1) * 360])),
        metalArea = area(
          triangle.map(([x, y]) => [(x + 1) * 640, (1 - y) * 360]),
        );
      expect(glArea).toBe(-metalArea);
      expect(glArea > 0 === (result.state.frontFace === 0x0901)).toBe(
        metalArea < 0 === (result.native.winding === 0),
      );
    }
});

test("native capture and returned states have separate mutable ownership", () => {
  const source = pipeline(1),
    result = directNativeMetalRasterToGles(source, convention);
  result.state.blendFactors[0] = 9;
  result.sourceState.frontFace = 99;
  expect(source.state.blendFactors[0]).toBe(1);
  expect(source.state.frontFace).toBe(0x0900);
  expect(result.sourceState.blendFactors[0]).toBe(1);
});

test("rejects unknown conventions, descriptor disagreement and double conversion", () => {
  expect(() => directNativeMetalRasterToGles(pipeline(1), {})).toThrow();
  expect(() =>
    directNativeMetalRasterToGles(pipeline(1), {
      ...convention,
      clipY: "inverted",
    }),
  ).toThrow();
  expect(() =>
    directNativeMetalRasterToGles(pipeline(1), {
      ...convention,
      targetViewportOrigin: "upper-left",
    }),
  ).toThrow();
  const source = pipeline(1);
  expect(() =>
    directNativeMetalRasterToGles(
      { ...source, state: { ...source.state, frontFace: 0x0901 } },
      convention,
    ),
  ).toThrow();
  expect(() =>
    directNativeMetalRasterToGles(
      { ...source, state: { ...source.state, cullEnabled: false } },
      convention,
    ),
  ).toThrow();
  const converted = directNativeMetalRasterToGles(source, convention);
  expect(() =>
    directNativeMetalRasterToGles(
      { ...source, state: converted.state },
      convention,
    ),
  ).toThrow();
  expect(() =>
    directNativeMetalRasterToGles(pipeline(2), convention),
  ).toThrow();
});
