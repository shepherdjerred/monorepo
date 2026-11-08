import { expect, test } from "bun:test";
import { directStaticMeshRetainedDraw as draw } from "./latest-direct-effect-static-mesh-draw.mjs";
function input() {
  return {
    birthBasis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    birthOrigin: [2, 3, 4],
    motion: [0, 0, 0],
    rootPosition: [10, 20, 30],
    bound: true,
    rotation: [0, 0, 0],
    birthScale: [2, 3, 4],
    sampledScale: [1, 1, 1],
    birthColor: [1, 0.5, 0.25, 0.5],
    sampledColor: [1, 1, 1, 0.5],
    fraction: 0.25,
    uniformScale: false,
    systemScale: [1, 1],
    resourceFields: {
      offset40: [0, 0, 0],
      offset4c: [0, 0, 0],
      offset58: [0, 0, 0],
      vector88: [0, 0, 0],
      flag94: 0,
    },
    definitionColor: [1, 1, 1, 1],
    textureDivisions: [1, 1],
    blendByte: 0,
    particleIndex: 0,
    linkedUvMatrices: [[2, 0, 0, 1, -0.5, 0], null],
  };
}
test("retained mesh handoff owns its output and preserves affine, color and UV contracts", () => {
  const supplied = input(),
    before = structuredClone(supplied),
    out = draw(supplied);
  expect(supplied).toEqual(before);
  expect(Array.from(out.particleMatrix.slice(12, 15))).toEqual([12, 23, 34]);
  expect(out.attributes).toHaveLength(44);
  expect(out.record).toHaveLength(176);
  expect(Array.from(out.parameters.kColorFactor)).toEqual([
    0.25, 0.125, 0.0625, 1,
  ]);
  expect(Array.from(out.parameters.COLOR_LOOKUP_UV)).toEqual([0.25, 1, 0, 0]);
  expect(Array.from(out.parameters.vParticleUVTransform)).toEqual([
    2, 0, -0.5, 0, 0, 1, 0, 0, 0, 0, 0, 0,
  ]);
  out.record.fill(0);
  expect(draw(supplied).record.some((v) => v !== 0)).toBe(true);
  expect(out.parameters.mWorld[3]).toBe(12);
});
test("mesh retained state rejects coercion, unresolved inputs and unsupported record providers", () => {
  for (const mutate of [
    (v) => {
      v.rootPosition[0] = null;
    },
    (v) => {
      v.birthBasis[0] = "1";
    },
    (v) => {
      v.birthColor = Array(4);
    },
    (v) => {
      v.motion[0] = Infinity;
    },
    (v) => {
      v.bound = 1;
    },
    (v) => {
      v.fraction = 1.1;
    },
    (v) => {
      v.fraction = null;
    },
    (v) => {
      v.linkedUvMatrices = Array(2);
    },
    (v) => {
      v.linkedUvMatrices[0] = [];
    },
    (v) => {
      v.resourceFields.flag94 = 1;
    },
    (v) => {
      v.uniformScale = 1;
    },
  ]) {
    const supplied = input();
    mutate(supplied);
    expect(() => draw(supplied)).toThrow();
  }
});
