import { expect, test } from "bun:test";
import {
  deriveSelectedMaterialParameterInputSpans,
  assertSelectedMaterialParameterInputSpans,
  deriveAuthoredSelectedMaterialSourceVectors,
} from "./latest-selected-material-parameter-inputs.mjs";
function graph() {
  const b = new Uint8Array(0x470),
    v = new DataView(b.buffer);
  v.setFloat32(0x8c, 2, true);
  v.setFloat32(0x90, 2, true);
  return {
    addresses: { definition: 0x10020000 },
    assetObjectHex: b.toHex(),
    segments: [{ address: 0x10020000, bytesHex: b.toHex() }],
  };
}
test("authored material inputs derive native vector bytes without candidate observations", () => {
  const source = {
      texDiv: [2, 2],
      textureMult: { texDivMult: [4, 2], texAddressModeMult: 1 },
      softParticleParams: {
        "{f314d542}": 2,
        deltaIn: 0.5,
        deltaOut: 4,
        "{3bf176bc}": 1,
      },
    },
    before = structuredClone(source),
    actual = deriveAuthoredSelectedMaterialSourceVectors(source);
  expect(actual.parameters.map((p) => p.bytesHex)).toEqual([
    "000000400000003f0000003f00000000",
    "000080400000803e0000003f00000000",
    "00000000000000000000000000000000",
    "0000000000000040000000400000803e",
    "000000000000803f0000803f00000000",
  ]);
  expect(actual.samplers[1].descriptorHex).toBe("0202020101");
  expect(source).toEqual(before);
});
test("changing source graph and candidate observations together cannot change authored material inputs", () => {
  const source = { texDiv: [2, 2] },
    candidate = graph();
  expect(assertSelectedMaterialParameterInputSpans(source, candidate)).toBe(
    true,
  );
  const b = Uint8Array.fromHex(candidate.assetObjectHex);
  new DataView(b.buffer).setFloat32(0x8c, 3, true);
  candidate.assetObjectHex = b.toHex();
  candidate.segments[0].bytesHex = candidate.assetObjectHex;
  expect(() =>
    assertSelectedMaterialParameterInputSpans(source, candidate),
  ).toThrow("differ from authored source");
  expect(
    deriveAuthoredSelectedMaterialSourceVectors(source).parameters[0].value[0],
  ).toBe(2);
  expect(() =>
    assertSelectedMaterialParameterInputSpans(
      { ...source, softParticleParams: {} },
      graph(),
    ),
  ).toThrow("presence differs");
});
test("numeric lowering rejects aliases, invalid native types, accessors and erosion", () => {
  for (const source of [
    { isTexturePixelated: 1 },
    { texAddressModeBase: 256 },
    { texDiv: [NaN, 1] },
    { texDiv: [1, 1], "{86a84509}": [2, 2] },
    { textureMult: { texDivMult: [1, 1], "{164b5733}": [2, 2] } },
    { textureMult: {}, "{2f2e99f2}": {} },
    { alphaErosionDefinition: {} },
    { textureMult: { __type: "OtherType" } },
  ])
    expect(() => deriveSelectedMaterialParameterInputSpans(source)).toThrow();
  let invoked = false;
  const source = {};
  Object.defineProperty(source, "texDiv", {
    get() {
      invoked = true;
      throw Error("getter ran");
    },
  });
  expect(() => deriveSelectedMaterialParameterInputSpans(source)).toThrow(
    "Own data",
  );
  expect(invoked).toBe(false);
});
test("authored native float lowering preserves signed zero and exact default branches", () => {
  const actual = deriveAuthoredSelectedMaterialSourceVectors({
    texDiv: [-0, 0],
    "{cb13aff1}": -0,
  });
  expect(Object.is(actual.parameters[0].value[0], -0)).toBe(true);
  expect(Object.is(actual.parameters[0].value[1], 0)).toBe(true);
  expect(Object.is(actual.parameters[2].value[0], -0)).toBe(true);
  expect(actual.parameters[1].value).toEqual([1, 1, 1, 0]);
  expect(actual.parameters.length).toBe(3);
});
