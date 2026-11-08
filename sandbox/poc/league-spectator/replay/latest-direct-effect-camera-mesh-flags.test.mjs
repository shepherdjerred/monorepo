import { expect, test } from "bun:test";
import {
  compileDirectCameraMeshFlags,
  validateDirectCameraMeshFlags,
  DIRECT_CAMERA_ZERO_MESH_FLAGS_POLICY as policy,
} from "./latest-direct-effect-camera-mesh-flags.mjs";

test("explicit zero retains a separate policy from the native absent/default-one branch", () => {
  expect(
    compileDirectCameraMeshFlags({ meshRenderFlags: 0 }, "camera-quad"),
  ).toBe(policy);
  expect(compileDirectCameraMeshFlags({}, "camera-quad")).toBeNull();
  expect(
    validateDirectCameraMeshFlags({ primitive: "camera-quad", source: {} }),
  ).toBeNull();
  expect(
    validateDirectCameraMeshFlags({
      primitive: "camera-quad",
      source: { meshRenderFlags: 0 },
      meshRenderFlagsPolicy: policy,
    }),
  ).toBe(policy);
});

test("nonzero and malformed values cannot inherit zero admission or silently become the constructor default", () => {
  for (const value of [
    1,
    2,
    255,
    -1,
    null,
    undefined,
    false,
    "0",
    NaN,
    Infinity,
  ]) {
    expect(
      compileDirectCameraMeshFlags({ meshRenderFlags: value }, "camera-quad"),
    ).toBeNull();
    for (const meshRenderFlagsPolicy of [null, policy])
      expect(() =>
        validateDirectCameraMeshFlags({
          primitive: "camera-quad",
          source: { meshRenderFlags: value },
          meshRenderFlagsPolicy,
        }),
      ).toThrow("mesh render flags policy");
  }
});

test("a zero declaration cannot waive other primitive programs or missing/conflicting policy", () => {
  for (const primitive of [
    "arbitrary-quad",
    "static-mesh",
    "ray",
    "camera-trail",
    "beam",
  ]) {
    expect(
      compileDirectCameraMeshFlags({ meshRenderFlags: 0 }, primitive),
    ).toBeNull();
    for (const meshRenderFlagsPolicy of [undefined, null, policy])
      expect(() =>
        validateDirectCameraMeshFlags({
          primitive,
          source: { meshRenderFlags: 0 },
          meshRenderFlagsPolicy,
        }),
      ).toThrow("mesh render flags policy");
  }
  expect(() =>
    validateDirectCameraMeshFlags({
      primitive: "camera-quad",
      source: { meshRenderFlags: 0 },
    }),
  ).toThrow("mesh render flags policy");
  expect(() =>
    validateDirectCameraMeshFlags({
      primitive: "camera-quad",
      source: {},
      meshRenderFlagsPolicy: policy,
    }),
  ).toThrow("mesh render flags policy");
});
