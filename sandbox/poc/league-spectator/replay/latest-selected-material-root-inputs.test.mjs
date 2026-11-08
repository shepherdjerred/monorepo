import { test, expect } from "bun:test";
import {
  deriveSelectedMaterialRootInputSpans as derive,
  assertSelectedMaterialRootInputSpans as assertSpans,
  assertSelectedMaterialNoWorldAccelerationCurve as noCurve,
} from "./latest-selected-material-root-inputs.mjs";
test("original material root scalar defaults and authored float/hash/flag inputs preserve exact bytes", () => {
  const defaults = derive({});
  expect(defaults.find((s) => s.offset === 0x72).bytesHex).toBe("0001");
  expect(defaults.find((s) => s.offset === 0x2d0).bytesHex).toBe("00202000");
  const spans = derive({
    blendMode: 4,
    depthBiasFactors: [-0, -50],
    StencilReferenceId: "{12345678}",
    "{0a5eb702}": 2.25,
    "{d1ee8634}": 1,
    useNavmeshMask: 1,
  });
  expect(spans.find((s) => s.offset === 0x14).bytesHex).toBe("04");
  expect(spans.find((s) => s.offset === 0x2d0).bytesHex).toBe("01602000");
  const fields = spans.find((s) => s.offset === 0x75).bytesHex;
  expect(fields.slice(6, 14)).toBe("78563412");
  expect(fields.slice(14, 30)).toBe("00000080000048c2");
  expect(fields.slice(30)).toBe("00001040");
});
test("no-curve guard binds authored IntegratedValueVector3 and rejects forged null curves", () => {
  const bytes = new Uint8Array(0x470),
    graph = { assetObjectHex: bytes.toHex() };
  expect(noCurve({}, graph).curvePointerNull).toBe(true);
  expect(
    noCurve({ worldAcceleration: { __type: "IntegratedValueVector3" } }, graph)
      .constantHex,
  ).toBe("000000000000000000000000");
  for (const value of [
    null,
    { __type: "IntegratedValueVector3", dynamics: null },
    { __type: "IntegratedValueVector3", dynamics: {} },
    { __type: "ValueVector3" },
    { __type: "IntegratedValueVector3", constantValue: [0, 0] },
  ])
    expect(() => noCurve({ worldAcceleration: value }, graph)).toThrow();
  const view = new DataView(bytes.buffer);
  view.setFloat32(0x370, -0, true);
  graph.assetObjectHex = bytes.toHex();
  expect(
    noCurve(
      {
        worldAcceleration: {
          __type: "IntegratedValueVector3",
          constantValue: [-0, 0, 0],
        },
      },
      graph,
    ).constantHex,
  ).toBe("000000800000000000000000");
  expect(() => noCurve({}, graph)).toThrow("differs");
  bytes[0x380] = 1;
  expect(() =>
    noCurve(
      {
        worldAcceleration: {
          __type: "IntegratedValueVector3",
          constantValue: [-0, 0, 0],
        },
      },
      { assetObjectHex: bytes.toHex() },
    ),
  ).toThrow("differs");
});
test("source projection rejects malformed typed inputs, accessors and hash aliases before graph approval", () => {
  for (const e of [
    { blendMode: null },
    { blendMode: 256 },
    { depthBiasFactors: [1] },
    { depthBiasFactors: [Infinity, 0] },
    { useNavmeshMask: true },
    { StencilReferenceId: 1 },
    { blendMode: 1, "{fa784eab}": 2 },
  ])
    expect(() => derive(e)).toThrow();
  let calls = 0;
  const emitter = {};
  Object.defineProperty(emitter, "blendMode", {
    get() {
      calls++;
      return 1;
    },
    enumerable: true,
  });
  expect(() => derive(emitter)).toThrow();
  expect(calls).toBe(0);
  const bytes = new Uint8Array(0x470);
  for (const s of derive({}))
    bytes.set(Uint8Array.fromHex(s.bytesHex), s.offset);
  const graph = { assetObjectHex: bytes.toHex() };
  expect(assertSpans({}, graph)).toEqual(derive({}));
  bytes[0x14] = 4;
  expect(() => assertSpans({}, { assetObjectHex: bytes.toHex() })).toThrow(
    "root input span",
  );
});
