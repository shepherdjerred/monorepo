import { expect, test } from "bun:test";
import {
  deriveSelectedMaterialSourceVectors,
  assertSelectedMaterialSourceVectors,
} from "./latest-selected-material-source-vectors.mjs";
function fixture() {
  const object = new Uint8Array(0x470),
    root = new DataView(object.buffer),
    soft = new Uint8Array(0x18),
    sv = new DataView(soft.buffer);
  root.setFloat32(0x8c, 1, true);
  root.setFloat32(0x90, 1, true);
  root.setBigUint64(0x30, 0x10400000n, true);
  [0, 2, 0.5, 4].forEach((n, i) => sv.setFloat32(i * 4, n, true));
  sv.setInt8(0x10, 1);
  return {
    addresses: { definition: 0x10020000 },
    assetObjectHex: object.toHex(),
    segments: [
      { address: 0x10020000, bytesHex: object.toHex() },
      { address: 0x10400000, bytesHex: soft.toHex() },
    ],
  };
}
const native = {
  parameters: [
    {
      name: "TEXTURE_INFO",
      bytesHex: "0000803f0000803f0000803f00000000",
      value: [1, 1, 1, 0],
    },
    {
      name: "TEXTURE_INFO_2",
      bytesHex: "0000803f0000803f0000803f00000000",
      value: [1, 1, 1, 0],
    },
    {
      name: "PARTICLE_DEPTH_PUSH_PULL",
      bytesHex: "00000000000000000000000000000000",
      value: [0, 0, 0, 0],
    },
    {
      name: "cSoftParticleParams",
      bytesHex: "0000000000000040000000400000803e",
      value: [0, 2, 2, 0.25],
    },
    {
      name: "cSoftParticleControl",
      bytesHex: "000000000000803f0000803f00000000",
      value: [0, 1, 1, 0],
    },
  ],
  samplers: [
    { layer: "base", slot: 0, descriptorHex: "0000000101" },
    { layer: "mult", slot: 7, descriptorHex: "0000000101" },
  ],
  erosionAtSuppliedDrive: null,
  erosionParameters: [],
};
test("static material source reads reproduce original soft branch and default mult inputs", () => {
  const graph = fixture(),
    before = structuredClone(graph);
  expect(deriveSelectedMaterialSourceVectors(graph)).toEqual(native);
  expect(assertSelectedMaterialSourceVectors(graph, native)).toBe(true);
  expect(graph).toEqual(before);
});
test("self-consistent candidate vector or sampler modifications cannot replace source outputs", () => {
  for (const mutate of [
    (v) => {
      v.parameters[0].bytesHex = "000040400000803f0000803f00000000";
      v.parameters[0].value[0] = 3;
    },
    (v) => (v.samplers[0].descriptorHex = "0101010000"),
    (v) => v.parameters.reverse(),
    (v) => (v.erosionAtSuppliedDrive = 0.5),
  ]) {
    const candidate = structuredClone(native);
    mutate(candidate);
    expect(() =>
      assertSelectedMaterialSourceVectors(fixture(), candidate),
    ).toThrow("differs from serialized source");
  }
});
test("material source reads require an unambiguous unchanged root and child owner", () => {
  for (const mutate of [
    (g) => g.segments.push({ ...g.segments[1] }),
    (g) => (g.segments[0].bytesHex = "01" + g.segments[0].bytesHex.slice(2)),
    (g) => g.segments.pop(),
    (g) => {
      const b = Uint8Array.fromHex(g.assetObjectHex);
      new DataView(b.buffer).setBigUint64(0x230, 0xffffffffffffffffn, true);
      g.assetObjectHex = b.toHex();
      g.segments[0].bytesHex = g.assetObjectHex;
    },
  ]) {
    const graph = fixture();
    mutate(graph);
    expect(() => deriveSelectedMaterialSourceVectors(graph)).toThrow();
  }
  let invoked = false;
  const graph = fixture();
  Object.defineProperty(graph, "assetObjectHex", {
    get() {
      invoked = true;
      throw Error("getter ran");
    },
  });
  expect(() => deriveSelectedMaterialSourceVectors(graph)).toThrow("Own data");
  expect(invoked).toBe(false);
});
test("source-derived byte lanes preserve signed zero and do not admit erosion", () => {
  const graph = fixture(),
    b = Uint8Array.fromHex(graph.assetObjectHex),
    v = new DataView(b.buffer);
  v.setFloat32(0x8c, -0, true);
  v.setFloat32(0x90, -0, true);
  v.setFloat32(0x33c, -0, true);
  graph.assetObjectHex = b.toHex();
  graph.segments[0].bytesHex = graph.assetObjectHex;
  const result = deriveSelectedMaterialSourceVectors(graph);
  expect(Object.is(result.parameters[0].value[0], -0)).toBe(true);
  expect(Object.is(result.parameters[0].value[1], 0)).toBe(true);
  expect(Object.is(result.parameters[2].value[0], -0)).toBe(true);
  v.setBigUint64(0x38, 0x10400100n, true);
  graph.assetObjectHex = b.toHex();
  graph.segments[0].bytesHex = graph.assetObjectHex;
  expect(() => deriveSelectedMaterialSourceVectors(graph)).toThrow(
    "do not admit erosion",
  );
});

test("masked soft numeric lanes still reject nonfinite source data", () => {
  const graph = fixture(),
    b = Uint8Array.fromHex(graph.segments[1].bytesHex);
  new DataView(b.buffer).setFloat32(4, NaN, true);
  graph.segments[1].bytesHex = b.toHex();
  expect(() => deriveSelectedMaterialSourceVectors(graph)).toThrow(
    "Finite serialized material float",
  );
});
