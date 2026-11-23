import { expect, test } from "bun:test";
import { sceneMaterialEnvironments } from "./scene-vfx-material-contract.mjs";
import {
  validateSceneMaterialRows,
  describeSceneMaterial,
} from "./scene-vfx-material-data.mjs";
const fixture = () => {
  const source = {
    effectId: "world/example/0/00000001",
    emitterIndex: 0,
    kind: "complex",
    sourceDefinitionSha256: "a".repeat(64),
    status: "native-bound-quad-prepared",
    resources: {
      boundQuad: { file: "parts/000000/0-quad.json", sha256: "b".repeat(64) },
    },
  };
  const row = {
    effectId: source.effectId,
    emitterIndex: 0,
    sourceDefinitionSha256: source.sourceDefinitionSha256,
    graphFile: source.resources.boundQuad.file,
    graphSha256: source.resources.boundQuad.sha256,
    primitiveKind: "camera",
    status: "original-material-selector-observed",
    definedObjectMask: 0,
    probes: sceneMaterialEnvironments(0).map((input) => ({ input, result: 0 })),
    parameters: [],
    samplers: [],
    erosionAtSuppliedDrive: null,
    erosionParameters: [],
  };
  const result = {
    selection: {
      vertex: "original-vs",
      pixel: "original-ps",
      linkShaderFlag1a: 0,
    },
    renderState: {
      uniforms: [],
      defines: [],
      bytesHex: "00",
      programPrefixHex: "00",
    },
  };
  return {
    native: { emitters: [source] },
    materials: { emitters: [row], resultCatalog: [result] },
    row,
  };
};
test("simple and complex original lists have separate ordinal namespaces", () => {
  const { native, materials } = fixture();
  native.emitters.push({
    ...native.emitters[0],
    kind: "simple",
    status: "unsupported-original-emitter-class",
    resources: {},
  });
  expect(validateSceneMaterialRows(materials, native).nativeRows.size).toBe(2);
  native.emitters.push({ ...native.emitters[0] });
  expect(() => validateSceneMaterialRows(materials, native)).toThrow(
    "Unique complete",
  );
});
test("material inventory cannot omit graphs or alter original pointer controls", () => {
  for (const mutate of [
    (value) => value.materials.emitters.pop(),
    (value) => value.materials.emitters[0].probes.pop(),
    (value) => (value.materials.emitters[0].graphSha256 = "c".repeat(64)),
    (value) => (value.materials.emitters[0].probes[0].input.resourceMask = 7),
    (value) => (value.native.emitters[0].kind = "unknown-root"),
    (value) => (value.native.emitters[0].status = "guessed-supported"),
  ]) {
    const value = fixture();
    mutate(value);
    expect(() =>
      validateSceneMaterialRows(value.materials, value.native),
    ).toThrow();
  }
});
test("only an observed environment and explicit erosion input produce a description", () => {
  const { materials, row } = fixture();
  const description = describeSceneMaterial(
    row,
    materials.resultCatalog,
    sceneMaterialEnvironments(0)[0],
    { erosionDrive: null },
    "16.21.829.8620",
  );
  expect(description.vertex).toBe("original-vs");
  expect(() =>
    describeSceneMaterial(
      row,
      materials.resultCatalog,
      { ...sceneMaterialEnvironments(0)[0], pass: 6, resourceMask: 7 },
      { erosionDrive: null },
      "16.21.829.8620",
    ),
  ).toThrow("not observed");
  expect(() =>
    describeSceneMaterial(
      row,
      materials.resultCatalog,
      sceneMaterialEnvironments(0)[0],
      {},
      "16.21.829.8620",
    ),
  ).toThrow("erosion");
});
test("erosion vector byte authority and finite dynamic input remain enforced", () => {
  const { native, materials, row } = fixture();
  row.erosionAtSuppliedDrive = 0.5;
  row.erosionParameters = [
    {
      name: "cAlphaErosionParams",
      bytesHex: "0000003f000000000000000000000000",
      value: [0.5, 0, 0, 0],
    },
  ];
  validateSceneMaterialRows(materials, native);
  expect(
    describeSceneMaterial(
      row,
      materials.resultCatalog,
      sceneMaterialEnvironments(0)[0],
      { erosionDrive: 0.25 },
      "16.21.829.8620",
    ).parameters.get("cAlphaErosionParams")[0],
  ).toBe(0.25);
  expect(() =>
    describeSceneMaterial(
      row,
      materials.resultCatalog,
      sceneMaterialEnvironments(0)[0],
      { erosionDrive: Infinity },
      "16.21.829.8620",
    ),
  ).toThrow("Finite");
  row.erosionParameters[0].value[0] = 0.75;
  expect(() => validateSceneMaterialRows(materials, native)).toThrow(
    "bytes/value",
  );
});
