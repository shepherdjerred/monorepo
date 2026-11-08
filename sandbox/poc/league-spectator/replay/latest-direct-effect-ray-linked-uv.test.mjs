import { test, expect } from "bun:test";
import { directRayLinkedGeometry } from "./latest-direct-effect-ray-linked-uv.mjs";
import { directRayGeometry } from "./latest-direct-effect-ray.mjs";
import { directTrailHalf } from "./latest-direct-effect-trail.mjs";
function input() {
  return {
    count: 2,
    positions: new Float32Array([0, 0, 0, 10, 20, 30]),
    axes: new Float32Array([0, 1, 0, 1, 0, 0]),
    attributes: new Float32Array([
      0.5, 1, 1, 1, 1, 2, 3, 0, 0.25, 1, 0, 2.5, 1, 1, 1, 1, 2, 3, 0, 0.75, 1,
      0,
    ]),
    viewPosition: [300, 900, 1200],
    systemScale: [1, 1],
    colorMultiplier: [1, 1, 1, 1],
    blendMode: 4,
    projectionScroll: 0,
    uvScale: [1, 1],
    emitterUv: [0, 0],
    baseUvPresent: true,
    multUvPresent: false,
    multTexturePresent: false,
    baseUvMatrices: new Float32Array([1, 0, 0, 1, 0, 0, 0.25, 0, 0, 1, 0.5, 0]),
  };
}
test("keeps retained reverse-pool order and all six half lanes", () => {
  const value = input(),
    before = structuredClone(value),
    actual = directRayLinkedGeometry(value),
    baseline = directRayGeometry({ ...value, baseUvPresent: false }),
    a = new DataView(actual.vertices.buffer),
    b = new DataView(baseline.vertices.buffer);
  expect(value).toEqual(before);
  expect(actual.indices).toEqual(baseline.indices);
  // Last retained particle uses the second authored matrix first.
  expect(a.getUint16(16, true)).toBe(directTrailHalf(0.5));
  expect(a.getUint16(44, true)).toBe(directTrailHalf(0.75));
  expect(a.getUint16(112 + 16, true)).toBe(directTrailHalf(0));
  for (let v = 0; v < 8; v++) {
    expect(actual.vertices.subarray(v * 28, v * 28 + 16)).toEqual(
      baseline.vertices.subarray(v * 28, v * 28 + 16),
    );
    for (let lane = 20; lane < 28; lane += 2)
      expect(a.getUint16(v * 28 + lane, true)).toBe(
        b.getUint16(v * 28 + lane, true),
      );
  }
});
test("applies global UV scale to linear lanes and emitter offsets to translation", () => {
  const value = input();
  value.uvScale = [2, 0.5];
  value.emitterUv = [0.125, -0.25];
  const a = new DataView(directRayLinkedGeometry(value).vertices.buffer);
  expect(a.getUint16(16, true)).toBe(directTrailHalf(0.625));
  expect(a.getUint16(18, true)).toBe(directTrailHalf(-0.25));
  expect(a.getUint16(44, true)).toBe(directTrailHalf(1.125));
  expect(a.getUint16(2 * 28 + 18, true)).toBe(directTrailHalf(0.25));
});
test("rejects unprepared matrices, mult texture, nonfinite and sparse vectors", () => {
  for (const change of [
    { baseUvPresent: false },
    { multUvPresent: true },
    { multTexturePresent: true },
    { baseUvMatrices: new Float32Array(11) },
    { baseUvMatrices: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0] },
  ])
    expect(() => directRayLinkedGeometry({ ...input(), ...change })).toThrow();
  const value = input();
  value.baseUvMatrices[4] = NaN;
  expect(() => directRayLinkedGeometry(value)).toThrow();
  expect(() =>
    directRayLinkedGeometry({ ...input(), viewPosition: [, 900, 1200] }),
  ).toThrow();
});
