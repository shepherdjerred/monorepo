import { test, expect } from "bun:test";
import { directRayGeometry } from "./latest-direct-effect-ray.mjs";

const fixture = () => ({
  count: 1,
  positions: new Float32Array([0, 0, 0]),
  axes: new Float32Array([0, 1, 0]),
  attributes: new Float32Array([
    0.75, 0.3, 0.6, 0.9, 0.4, 2, 4, -1, 0.25, 1, 0.125,
  ]),
  viewPosition: [0, 0, 10],
  systemScale: [1, 1],
  colorMultiplier: [1, 1, 1, 1],
  blendMode: 1,
  projectionScroll: 0,
  uvScale: [1, 1],
  emitterUv: [0, 0],
  baseUvPresent: false,
  multUvPresent: false,
  multTexturePresent: false,
});
test("ray uses an orientation column, length, offset and camera-facing width", () => {
  const geometry = directRayGeometry(fixture()),
    d = new DataView(geometry.vertices.buffer);
  expect(Array.from(geometry.indices)).toEqual([0, 1, 2, 0, 2, 3]);
  expect(
    Array.from({ length: 4 }, (_, i) =>
      Array.from({ length: 3 }, (_, lane) =>
        d.getFloat32(i * 28 + lane * 4, true),
      ),
    ),
  ).toEqual([
    [-1, 3, 0],
    [1, 3, 0],
    [1, -1, 0],
    [-1, -1, 0],
  ]);
  expect(Array.from(geometry.vertices.subarray(12, 16))).toEqual([
    230, 153, 77, 102,
  ]);
  expect(
    Array.from({ length: 6 }, (_, i) => d.getUint16(16 + i * 2, true)),
  ).toEqual([0, 0, 0x3a00, 0x3000, 0x3400, 0x3c00]);
});
test("camera changes and repeated draws leave retained input arrays independent", () => {
  const a = fixture(),
    before = structuredClone(a),
    first = directRayGeometry(a);
  first.vertices.fill(255);
  first.indices.fill(17);
  const next = directRayGeometry(a),
    orbit = directRayGeometry({ ...a, viewPosition: [10, 0, 0] });
  expect(a).toEqual(before);
  expect(next.indices[0]).toBe(0);
  expect(next.vertices).not.toEqual(first.vertices);
  expect(orbit.vertices).not.toEqual(next.vertices);
});
test("ray zero-axis normalization retains native degeneracy and empty pools", () => {
  const a = fixture();
  a.axes.fill(0);
  const out = directRayGeometry(a),
    data = new DataView(out.vertices.buffer);
  expect(
    Array.from({ length: 4 }, (_, i) => data.getFloat32(i * 28, true)),
  ).toEqual([0, 0, 0, 0]);
  const empty = directRayGeometry({
    ...a,
    count: 0,
    positions: new Float32Array(),
    axes: new Float32Array(),
    attributes: new Float32Array(),
  });
  expect(empty.vertices.byteLength + empty.indices.byteLength).toBe(0);
});
test("ray inline color saturation differs from wrapped quad packing", () => {
  const a = fixture();
  a.attributes.set([-1, 2, 0.5, 1.5], 1);
  expect(Array.from(directRayGeometry(a).vertices.subarray(12, 16))).toEqual([
    128, 255, 0, 255,
  ]);
  expect(
    Array.from(
      directRayGeometry({ ...fixture(), blendMode: 0 }).vertices.subarray(
        12,
        16,
      ),
    ),
  ).toEqual([92, 61, 31, 255]);
});
test("unsupported projection and UV bindings fail before geometry generation", () => {
  for (const override of [
    { projectionScroll: 1 },
    { baseUvPresent: true },
    { multUvPresent: true },
    { multTexturePresent: true },
    { blendMode: 2 },
    { axes: new Float32Array([Infinity, 0, 0]) },
    { viewPosition: ["0", 0, 1] },
    { attributes: new Float32Array(10) },
    { count: 1025 },
  ])
    expect(() => directRayGeometry({ ...fixture(), ...override })).toThrow(
      /Explicit finite ray inputs/,
    );
});
