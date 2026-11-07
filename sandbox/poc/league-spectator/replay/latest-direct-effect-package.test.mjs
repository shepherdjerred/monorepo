import { expect, test } from "bun:test";
import { directEmitterMaterialAdmission } from "./latest-direct-effect-package.mjs";
import { DIRECT_GROUND_POLICY } from "./latest-direct-ground-policy.mjs";
import { compileDirectDepthDisabledSoftParticles } from "./latest-direct-effect-soft.mjs";

test("an unimplemented ground binding omits the component even when pass0 exists", () => {
  const key = "effect:3";
  const pass0 = { nativePass: 0 };
  const ordinary = new Map([[key, pass0]]);
  const result = directEmitterMaterialAdmission(
    {
      materialKey: key,
      groundLayer: true,
      materialPolicy: DIRECT_GROUND_POLICY,
    },
    new Map(),
    ordinary,
  );
  expect(result.material).toBeUndefined();
  expect(result.reasons).toEqual([
    "material:native-ground-pass5-binding-unprepared",
  ]);
  expect(ordinary.get(key)).toBe(pass0);
});

test("ground admission uses only the prepared ground binding and rejects an incompatible compiled policy", () => {
  const emitter = {
    materialKey: "effect:3",
    groundLayer: true,
    materialPolicy: DIRECT_GROUND_POLICY,
  };
  const pass5 = { nativePass: 5 };
  const ground = new Map([[emitter.materialKey, pass5]]);
  expect(directEmitterMaterialAdmission(emitter, ground, new Map())).toEqual({
    material: pass5,
    reasons: [],
  });
  expect(() =>
    directEmitterMaterialAdmission(
      { ...emitter, materialPolicy: null },
      ground,
      new Map(),
    ),
  ).toThrow("exact native pass5");
});

test("an unimplemented ordinary binding retains its distinct omission", () => {
  expect(
    directEmitterMaterialAdmission(
      { groundLayer: false, materialKey: "effect:3" },
      new Map(),
      new Map(),
    ).reasons,
  ).toEqual(["material:translated-shader-binding"]);
});

test("a soft component cannot use a different prepared graphics environment", () => {
  const source = {
    softParticleParams: {
      __type: "VfxSoftParticleDefinitionData",
      deltaIn: 100,
    },
    blendMode: 1,
    alphaRef: 0,
  };
  const emitter = {
    source,
    groundLayer: false,
    primitive: "arbitrary-quad",
    materialKey: "generic:0",
    softParticlePolicy: compileDirectDepthDisabledSoftParticles(
      source,
      "arbitrary-quad",
      false,
    ),
  };
  expect(() =>
    directEmitterMaterialAdmission(
      emitter,
      new Map(),
      new Map([
        [
          emitter.materialKey,
          { prepared: { environment: { graphics34b: true, graphics29c: 2 } } },
        ],
      ]),
    ),
  ).toThrow("Exact native depth-disabled soft-particle material required");
  expect(
    directEmitterMaterialAdmission(emitter, new Map(), new Map()).reasons,
  ).toEqual(["material:translated-shader-binding"]);
  expect(() =>
    directEmitterMaterialAdmission(
      { ...emitter, softParticlePolicy: null },
      new Map(),
      new Map(),
    ),
  ).toThrow("Malformed compiled depth-disabled soft-particle policy");
});
