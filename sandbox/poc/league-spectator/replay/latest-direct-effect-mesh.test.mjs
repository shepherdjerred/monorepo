import { expect, test } from "bun:test";
import {
  directStaticMeshGeometry,
  directStaticMeshParticleMatrix,
  directStaticMeshResourceFields,
} from "./latest-direct-effect-mesh.mjs";
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  fields = () => directStaticMeshResourceFields(new Uint8Array(0xe0)),
  inputs = () => ({
    particleMatrix: [...identity.slice(0, 12), 10, 20, 30, 1],
    scale: [2, 3, 4],
    uniformScale: false,
    systemScale: [2, 0.5],
    resourceFields: fields(),
  });

test("ordinary static mesh matrices preserve world position and apply authored uniform selection", () => {
  expect([...directStaticMeshParticleMatrix(inputs())]).toEqual([
    2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 10, 20, 30, 1,
  ]);
  const input = inputs();
  input.uniformScale = true;
  expect([...directStaticMeshParticleMatrix(input)]).toEqual([
    2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 20, 30, 1,
  ]);
  input.particleMatrix = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 10, 20, 30, 1];
  const actual = directStaticMeshParticleMatrix(input);
  expect([...actual.slice(0, 12)]).toEqual([
    0, 0, -2, 0, 0, 2, 0, 0, 2, 0, 0, 0,
  ]);
  expect([...actual.slice(12)]).toEqual([10, 20, 30, 1]);
});

test("mesh vertex decoding preserves original native fields and independent ownership", () => {
  const padded = new Uint8Array(120),
    bytes = padded.subarray(4, 112),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      view.setFloat32(i * 36 + j * 4, i + j, true);
      view.setFloat32(i * 36 + 12 + j * 4, j === 1 ? 1 : 0, true);
    }
    bytes.set([3, 7, 11, 255], i * 36 + 24);
    view.setFloat32(i * 36 + 28, 0.25, true);
    view.setFloat32(i * 36 + 32, 0.75, true);
  }
  const geometry = directStaticMeshGeometry(bytes, 1);
  expect(geometry.vertexCount).toBe(3);
  expect([...geometry.positions]).toEqual([0, 1, 2, 1, 2, 3, 2, 3, 4]);
  expect([...geometry.normals]).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  expect([...geometry.colors]).toEqual([
    3, 7, 11, 255, 3, 7, 11, 255, 3, 7, 11, 255,
  ]);
  expect([...geometry.uv]).toEqual([0.25, 0.75, 0.25, 0.75, 0.25, 0.75]);
  const again = directStaticMeshGeometry(bytes, 1);
  geometry.positions[0] = 999;
  bytes.fill(0);
  expect(again.positions[0]).toBe(0);
  expect(again.colors[0]).toBe(3);
});

test("pivot, nonaffine, sparse and nonfinite inputs remain explicit unsupported boundaries", () => {
  for (const mutate of [
    (x) => {
      x.resourceFields.flag94 = 1;
    },
    (x) => {
      delete x.scale[0];
    },
    (x) => {
      delete x.particleMatrix[0];
    },
    (x) => {
      x.systemScale[0] = Infinity;
    },
    (x) => {
      x.particleMatrix[3] = 1;
    },
    (x) => {
      x.uniformScale = 1;
    },
  ]) {
    const input = inputs();
    mutate(input);
    expect(() => directStaticMeshParticleMatrix(input)).toThrow("unsupported");
  }
  expect(() => directStaticMeshGeometry(new Uint8Array(108), 0)).toThrow();
  expect(() => directStaticMeshGeometry(new Uint8Array(109), 1)).toThrow();
  const bytes = new Uint8Array(108);
  new DataView(bytes.buffer).setFloat32(12, NaN, true);
  expect(() => directStaticMeshGeometry(bytes, 1)).toThrow("Nonfinite");
});
