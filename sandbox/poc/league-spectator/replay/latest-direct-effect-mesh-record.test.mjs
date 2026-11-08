import { expect, test } from "bun:test";
import {
  directStaticMeshCpuRecord,
  directStaticMeshDrawParameters,
} from "./latest-direct-effect-mesh-record.mjs";

function fixture() {
  return {
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12, 24, 48, 1],
    attributes: new Uint8Array(
      new Float32Array([5.75, 0.25, 0.5, 0.75, 0.375, 6, 3.5, 3.5, -0, 1, 0])
        .buffer,
    ),
    definitionColor: [0.5, 0.75, 0.25, 0.875],
    textureDivisions: [4, 2],
    blendByte: 0,
    paletteByte: 3,
    particleIndex: 7,
    facingFlags: [false, false, false],
    linkedUvFlags: [false, false],
    linkedUvMatrices: [null, null],
  };
}

test("mesh CPU record keeps atlas, premultiplied color and raw trailing lanes", () => {
  const input = fixture(),
    record = directStaticMeshCpuRecord(input),
    view = new DataView(record.buffer);
  expect(record.length).toBe(176);
  expect(Array.from(new Float32Array(record.buffer, 0x60, 6))).toEqual([
    0.25, 0, 0, 0.5, 0.25, 0.5,
  ]);
  expect(Array.from(new Float32Array(record.buffer, 0x90, 4))).toEqual([
    0.041015625, 0.123046875, 0.0615234375, 1,
  ]);
  expect(view.getUint32(0x5c, true)).toBe(7);
  expect(view.getUint32(0xa0, true)).toBe(0x80000000);
  expect(view.getUint32(0xac, true)).toBe(1);
  record.fill(255);
  expect(input.matrix[0]).toBe(1);
  expect(new DataView(input.attributes.buffer).getFloat32(0, true)).toBe(5.75);
});

test("record rejects unknown providers and malformed values before returning data", () => {
  expect(() =>
    directStaticMeshCpuRecord({ ...fixture(), linkedUvFlags: [true, false] }),
  ).toThrow("linked UV");
  expect(() =>
    directStaticMeshCpuRecord({
      ...fixture(),
      facingFlags: [false, true, false],
    }),
  ).toThrow("facing");
  expect(() =>
    directStaticMeshCpuRecord({
      ...fixture(),
      matrix: [, ...fixture().matrix.slice(1)],
    }),
  ).toThrow("world matrix");
  expect(() =>
    directStaticMeshCpuRecord({ ...fixture(), attributes: new Uint8Array(43) }),
  ).toThrow("attributes");
  expect(() =>
    directStaticMeshCpuRecord({ ...fixture(), paletteByte: 256 }),
  ).toThrow("palette");
  const input = fixture();
  new DataView(input.attributes.buffer).setFloat32(0, 0x80000000, true);
  expect(() => directStaticMeshCpuRecord(input)).toThrow("integer conversion");
});

test("individual draw packing applies authored centered UV scale exactly once", () => {
  const input = fixture();
  input.textureDivisions = [1, 1];
  input.paletteByte = 0;
  input.linkedUvFlags = [true, false];
  input.linkedUvMatrices = [[2, 0, 0, 1, -0.5, 0], null];
  const record = directStaticMeshCpuRecord(input);
  const parameters = directStaticMeshDrawParameters({
    record,
    resourceOffset40: [1, 2, 3],
    paletteByte: 0,
    multTexturePresent: false,
  });
  expect(Array.from(parameters.vParticleUVTransform)).toEqual([
    2, 0, -0.5, 0, 0, 1, 5, 0, 0, 0, 0, 0,
  ]);
  expect(Array.from(parameters.DYNAMIC_MESH_CENTER)).toEqual([13, 26, 51]);
  expect(Array.from(parameters.mWorld)).toEqual([
    1, 0, 0, 12, 0, 1, 0, 24, 0, 0, 1, 48, 0, 0, 0, 1,
  ]);
  expect(Array.from(parameters.COLOR_LOOKUP_UV)).toEqual([-0, 1, 0, 0]);
  parameters.mWorld.fill(999);
  expect(new DataView(record.buffer).getFloat32(0, true)).toBe(1);
  expect(() =>
    directStaticMeshDrawParameters({
      record,
      resourceOffset40: [0, 0, 0],
      paletteByte: 1,
      multTexturePresent: false,
    }),
  ).toThrow("palette");
  const corrupt = record.slice();
  new DataView(corrupt.buffer).setUint32(0xac, 1, true);
  expect(() =>
    directStaticMeshDrawParameters({
      record: corrupt,
      resourceOffset40: [0, 0, 0],
      paletteByte: 0,
      multTexturePresent: false,
    }),
  ).toThrow("provenance");
  new DataView(corrupt.buffer).setUint32(0xac, 0, true);
  new DataView(corrupt.buffer).setFloat32(0xa0, NaN, true);
  expect(() =>
    directStaticMeshDrawParameters({
      record: corrupt,
      resourceOffset40: [0, 0, 0],
      paletteByte: 0,
      multTexturePresent: false,
    }),
  ).toThrow("color lookup");
});
