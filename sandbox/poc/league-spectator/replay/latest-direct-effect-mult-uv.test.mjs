import { test, expect } from "bun:test";
import {
  compileDirectConstantMultUv as compile,
  validateDirectConstantMultUv as validate,
  directConstantMultUvCorners as corners,
  compileDirectMultUv,
  validateDirectMultUv,
  sampleDirectMultUvCorners,
  directMultUvSourceOmissions,
} from "./latest-direct-effect-mult-uv.mjs";
const source = () => ({
  textureMult: {
    __type: "VfxTextureMultDefinitionData",
    textureMult: "control.tex",
    UvRotationMult: { __type: "ValueFloat", constantValue: -90 },
  },
});
const curvedSource = () => ({
  textureMult: {
    __type: "VfxTextureMultDefinitionData",
    textureMult: "control.tex",
    uvScaleMult: {
      __type: "ValueVector2",
      constantValue: [0.7, 0.7],
      dynamics: {
        __type: "VfxAnimatedVector2fVariableData",
        times: [0, 0.5, 1],
        values: [
          [2, 2],
          [0.8, 0.8],
          [0.5, 0.5],
        ],
        probabilityTables: [
          { __type: "VfxProbabilityTableData" },
          { __type: "VfxProbabilityTableData" },
        ],
      },
    },
  },
});
test("dynamic multiply programs retain exact authored curves and explicit particle clock", () => {
  const s = curvedSource(),
    p = compileDirectMultUv(s, "arbitrary-quad"),
    e = { source: s, primitive: "arbitrary-quad", multUvProgram: p };
  expect(p.clock).toBe("normalized-particle-age");
  expect(p.scale).toBeUndefined();
  expect(validateDirectMultUv(e)).toBe(true);
  expect(() => validate(e)).toThrow();
  const calls = [],
    kernel = {
      sample: (field, age, fallback) => {
        calls.push({ field, age, fallback });
        return [2, 2];
      },
    };
  const output = sampleDirectMultUvCorners(p, 0.125, kernel);
  expect(output).toEqual(corners({ ...p, scale: [2, 2] }));
  expect(calls).toEqual([
    { field: p.scaleField, age: 0.125, fallback: [1, 1] },
  ]);
  expect(p.scaleField).not.toBe(s.textureMult.uvScaleMult);
  for (const mutate of [
    (p) => (p.clock = "emitter-age"),
    (p) => (p.scaleField.dynamics.values[1][0] = 1),
    (p) => (p.scale = [1, 1]),
  ]) {
    const changed = structuredClone(p);
    mutate(changed);
    expect(() =>
      validateDirectMultUv({ ...e, multUvProgram: changed }),
    ).toThrow();
  }
});
test("dynamic multiply source guard rejects unsupported curves, RNG, scrolling and atlas", () => {
  for (const mutate of [
    (s) => (s.textureMult.uvScaleMult.dynamics.times[1] = 0),
    (s) => s.textureMult.uvScaleMult.dynamics.values.pop(),
    (s) => (s.textureMult.uvScaleMult.dynamics.values[1][0] = Infinity),
    (s) =>
      (s.textureMult.uvScaleMult.dynamics.probabilityTables[0].singleValue = 0.5),
    (s) => (s.textureMult.uvScaleMult.extra = 0),
    (s) => (s.textureMult.uvScaleMult.dynamics.extra = 0),
    (s) =>
      (s.textureMult.uvScrollMult = {
        __type: "ValueVector2",
        constantValue: [1, 0],
      }),
    (s) => (s.textureMult.texDivMult = [2, 2]),
    (s) => (s.texDiv = [2, 2]),
    (s) =>
      (s.textureMult.UvRotationMult = {
        __type: "ValueFloat",
        dynamics: { times: [0, 1], values: [0, 90] },
      }),
  ]) {
    const s = curvedSource();
    mutate(s);
    expect(compileDirectMultUv(s, "arbitrary-quad")).toBeNull();
  }
});
test("multiply source diagnostics name untranslated fields independently of material admission", () => {
  const s = curvedSource();
  s.textureMult.uvScaleMult.dynamics.probabilityTables[0].singleValue = 0.5;
  s.textureMult.uvScrollMult = {
    __type: "ValueVector2",
    constantValue: [1, 0],
  };
  expect(directMultUvSourceOmissions(s, "arbitrary-quad")).toEqual([
    "mult-uv:field-uvScrollMult-untranslated",
    "mult-uv:scale-curve-invalid-or-probability-untranslated",
  ]);
  expect(directMultUvSourceOmissions(curvedSource(), "arbitrary-quad")).toEqual(
    [],
  );
});
test("multiply UV preserves original half subnormal and signed-zero corner lanes", () => {
  const s = source(),
    program = compile(s, "arbitrary-quad");
  expect(Array.from(corners(program))).toEqual([
    0x3c00, 1, 0x3c00, 0x3c00, 0, 0x3c00, 0, 0x8000,
  ]);
  expect(
    validate({
      source: s,
      primitive: "arbitrary-quad",
      multUvProgram: program,
    }),
  ).toBe(true);
  expect(s.textureMult.UvRotationMult.constantValue).toBe(-90);
});
test("unsupported multiply-UV fields and absent resources cannot be admitted", () => {
  for (const mutate of [
    (s) =>
      (s.textureMult.uvScaleMult = { __type: "ValueVector2", dynamics: {} }),
    (s) =>
      (s.textureMult.birthUvScrollRateMult = {
        __type: "ValueVector2",
        constantValue: [0, 1],
      }),
    (s) => (s.textureMult.texAddressModeMult = 3),
    (s) => (s.textureMult.texAddressModeMult = false),
    (s) => (s.textureMult.UvRotationMult = undefined),
    (s) => (s.textureMult.UvRotationMult.constantValue = Infinity),
    (s) => (s.textureMult.textureMult = ""),
    (s) => (s.textureMult.texDivMult = [2, 2]),
    (s) => (s.textureMult.TextureMultFilpU = true),
    (s) => (s.particleColorTexture = "palette.tex"),
    (s) => (s.numFrames = 4),
    (s) => (s.texDiv = [2, 2]),
  ]) {
    const s = source();
    mutate(s);
    expect(compile(s, "arbitrary-quad")).toBeNull();
  }
  expect(compile(source(), "ray")).toBeNull();
  expect(compile(source(), "static-mesh")).toBeNull();
  expect(
    compile(
      { textureMult: Object.create(source().textureMult) },
      "camera-quad",
    ),
  ).toBeNull();
});
test("derived multiply-UV programs must retain their complete authored inputs", () => {
  const s = source(),
    p = compile(s, "camera-quad"),
    emitter = { source: s, primitive: "camera-quad", multUvProgram: p };
  for (const mutate of [
    (p) => (p.rotation = 90),
    (p) => (p.scale[0] = 2),
    (p) => (p.offset[0] = 0.25),
    (p) => (p.texture = "other.tex"),
    (p) => (p.addressMode = 2),
    (p) => (p.linked = false),
    (p) => (p.extra = true),
  ]) {
    const changed = structuredClone(p);
    mutate(changed);
    expect(() => validate({ ...emitter, multUvProgram: changed })).toThrow();
  }
  expect(() => validate({ source: s, primitive: "camera-quad" })).toThrow();
  expect(validate({ source: {}, primitive: "camera-quad" })).toBe(false);
});
