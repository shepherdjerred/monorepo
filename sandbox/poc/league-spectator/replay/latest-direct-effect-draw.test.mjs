import { expect, test } from "bun:test";
import {
  directRenderAttributes,
  directGeometryBuffers,
} from "./latest-direct-effect-draw.mjs";
import { directDrawTransfers } from "./latest-direct-effect-runtime.mjs";

const quad = () => ({
  particleCount: 2,
  positions: new Float32Array(24),
  colors: new Float32Array(32).fill(1),
  uv: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]),
  particleUV: Uint16Array.from([
    0x3c00, 0x3400, 0x3c00, 0x4200, 0x3a00, 0x3c00,
  ]),
  indices: Uint16Array.from([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
});

test("replicates compact native frame and palette halves at every quad corner", () => {
  const draw = quad(),
    attributes = directRenderAttributes(draw),
    packed = directGeometryBuffers(draw),
    bytes = new DataView(packed.vertices.buffer);
  for (let vertex = 0; vertex < 8; vertex++) {
    const particle = Math.floor(vertex / 4),
      expected = [
        draw.uv[vertex * 2] ? 0x3c00 : 0,
        draw.uv[vertex * 2 + 1] ? 0x3c00 : 0,
        draw.particleUV[particle * 3],
        0,
        draw.particleUV[particle * 3 + 1],
        0x3c00,
      ];
    expect([
      ...attributes.a_TEXCOORD.subarray(vertex * 4, vertex * 4 + 4),
      ...attributes.a_TEXCOORD1.subarray(vertex * 2, vertex * 2 + 2),
    ]).toEqual(expected);
    expect(
      Array.from({ length: 6 }, (_, lane) =>
        bytes.getUint16(vertex * 28 + 16 + lane * 2, true),
      ),
    ).toEqual(expected);
  }
  expect(packed.indices).toEqual(new Uint8Array(draw.indices.buffer));
});

test("rejects absent, malformed and unadmitted packed particle UV lanes", () => {
  for (const invalid of [
    undefined,
    [0, 0, 0x3c00, 0, 0, 0x3c00],
    new Uint16Array(3),
    Uint16Array.from([0x7c00, 0, 0x3c00, 0, 0, 0x3c00]),
    Uint16Array.from([0, 0x8000, 0x3c00, 0, 0, 0x3c00]),
    Uint16Array.from([0, 0x3c01, 0x3c00, 0, 0, 0x3c00]),
    Uint16Array.from([0, 0, 0, 0, 0, 0x3c00]),
  ])
    expect(() =>
      directRenderAttributes({ ...quad(), particleUV: invalid }),
    ).toThrow("Malformed direct draw buffers");
});

test("constant multiply corners replace only the shader's secondary UV stream", () => {
  const draw = {
      ...quad(),
      multUV: Uint16Array.from([
        0x3c00, 1, 0x3c00, 0x3c00, 0, 0x3c00, 0, 0x8000,
      ]),
    },
    attributes = directRenderAttributes(draw),
    before = directRenderAttributes(quad());
  expect(attributes.a_TEXCOORD).toEqual(before.a_TEXCOORD);
  expect(attributes.a_COLOR).toEqual(before.a_COLOR);
  expect(attributes.a_TEXCOORD1).toEqual(
    Uint16Array.from([...draw.multUV, ...draw.multUV]),
  );
  expect(
    directDrawTransfers({ draws: [draw] }).filter(
      (b) => b === draw.multUV.buffer,
    ),
  ).toHaveLength(1);
  for (const multUV of [
    null,
    [],
    new Uint16Array(6),
    new Float32Array(8),
    Uint16Array.from([0x7c00, 0, 0, 0, 0, 0, 0, 0]),
  ])
    expect(() => directRenderAttributes({ ...draw, multUV })).toThrow(
      "Malformed direct draw buffers",
    );
});

test("multiply scale curves retain distinct UV corners for overlapping particles", () => {
  const multUV = Uint16Array.from([
      0x3c00, 1, 0x3c00, 0x3c00, 0, 0x3c00, 0, 0x8000, 0x3800, 0x3800, 0x3a00,
      0x3800, 0x3a00, 0x3a00, 0x3800, 0x3a00,
    ]),
    draw = { ...quad(), multUV },
    attributes = directRenderAttributes(draw),
    packed = directGeometryBuffers(draw),
    bytes = new DataView(packed.vertices.buffer);
  expect(attributes.a_TEXCOORD1).toEqual(multUV);
  expect(attributes.a_TEXCOORD).toEqual(
    directRenderAttributes(quad()).a_TEXCOORD,
  );
  for (let vertex = 0; vertex < 8; vertex++)
    for (let lane = 0; lane < 2; lane++)
      expect(bytes.getUint16(vertex * 28 + 24 + lane * 2, true)).toBe(
        multUV[vertex * 2 + lane],
      );
  expect(directDrawTransfers({ draws: [draw] })).toContain(multUV.buffer);
  expect(() =>
    directRenderAttributes({ ...draw, multUV: multUV.slice(0, 14) }),
  ).toThrow("Malformed direct draw buffers");
});

test("ray packets retain all six native half lanes and four vertices per particle", () => {
  const vertexBytes = new Uint8Array(224),
    view = new DataView(vertexBytes.buffer);
  for (let vertex = 0; vertex < 8; vertex++) {
    view.setFloat32(vertex * 28, vertex + 0.5, true);
    vertexBytes.set([11, 22, 33, 44], vertex * 28 + 12);
    for (let lane = 0; lane < 6; lane++)
      view.setUint16(
        vertex * 28 + 16 + lane * 2,
        0x3000 + vertex * 8 + lane,
        true,
      );
  }
  const draw = {
    primitive: "ray",
    particleCount: 2,
    vertexBytes,
    indices: Uint16Array.from([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
  };
  const attributes = directRenderAttributes(draw),
    packed = directGeometryBuffers(draw);
  expect(packed.vertices).toEqual(vertexBytes);
  expect(packed.vertices.buffer).not.toBe(vertexBytes.buffer);
  expect(attributes.a_POSITION[21]).toBe(7.5);
  expect([...attributes.a_COLOR.slice(-4)]).toEqual([11, 22, 33, 44]);
  for (let vertex = 0; vertex < 8; vertex++)
    expect([
      ...attributes.a_TEXCOORD.slice(vertex * 4, vertex * 4 + 4),
      ...attributes.a_TEXCOORD1.slice(vertex * 2, vertex * 2 + 2),
    ]).toEqual(
      Array.from({ length: 6 }, (_, lane) => 0x3000 + vertex * 8 + lane),
    );
  expect(() =>
    directRenderAttributes({ ...draw, primitive: "camera-trail" }),
  ).toThrow();
  expect(() =>
    directRenderAttributes({
      ...draw,
      indices: Uint16Array.from([0, 1, 8, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
    }),
  ).toThrow();
});
