import { expect, test } from "bun:test";
import { directZeroBoundFlex } from "./latest-direct-effect-flex.mjs";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import {
  DIRECT_EFFECT_BUILD as build,
  DIRECT_EFFECT_PROTOCOL as protocol,
} from "./latest-direct-effect-runtime.mjs";
import { sha256 } from "./structural-comparison.mjs";

const flex = () => ({
  __type: "VfxFlexShapeDefinitionData",
  scaleBirthScaleByBoundObjectSize: Math.fround(0.005),
});
const kernels = {
  birth: {
    sampleValue: (field, _time, fallback) => field?.constantValue ?? fallback,
    createRandom: () => ({ next: () => 0.5 }),
  },
  emission: { eligibility: () => ({ reasons: [] }) },
  samplers: { describe: () => ({ previewSupported: true }) },
};
async function compile(extra = {}) {
  const id = "generic/flex-condition-control";
  const definitionBytes = new TextEncoder().encode(
    JSON.stringify({
      definition: {
        __type: "VfxSystemDefinitionData",
        complexEmitterDefinitionData: [
          {
            __type: "VfxEmitterDefinitionData",
            texture: "control.png",
            blendMode: 1,
            EmitterPosition: {
              __type: "ValueVector3",
              constantValue: [0, 5, 0],
            },
            ...extra,
          },
        ],
      },
    }),
  );
  const manifest = {
    build,
    protocol,
    definitions: { [id]: { sha256: await sha256(definitionBytes) } },
    assets: { "control.png": { kind: "texture", status: "prepared" } },
  };
  return compileLatestDirectEffect({
    id,
    definitionBytes,
    manifest,
    manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
    kernels,
  });
}

test("compiled emitters declare required world inputs and retain exact conditional Flex source", async () => {
  const ordinary = await compile();
  expect(ordinary.emitters[0].placementRequirements).toEqual({
    rootBasis: true,
    boundObjectSize: null,
  });
  const authored = flex();
  const conditional = await compile({ FlexShapeDefinition: authored });
  expect(conditional.emitters).toHaveLength(1);
  expect(conditional.emitters[0].placementRequirements).toEqual({
    rootBasis: true,
    boundObjectSize: "finite-nonnegative",
  });
  expect(conditional.emitters[0].source.FlexShapeDefinition).toEqual(authored);
  expect(
    Object.isFrozen(conditional.emitters[0].source.FlexShapeDefinition),
  ).toBe(true);
});

test("other Flex coefficients, fields and types remain explicit unsupported components", async () => {
  const invalid = [
    null,
    {},
    [],
    { __type: "VfxFlexShapeDefinitionData" },
    { ...flex(), __type: "unknown" },
    { ...flex(), extra: 0 },
    { ...flex(), scaleEmitOffsetByBoundObjectSize: 0 },
    ...[0, -0, 0.005, 1, 100, false, "0.005", null, {}, [], NaN, Infinity].map(
      (coefficient) => ({
        ...flex(),
        scaleBirthScaleByBoundObjectSize: coefficient,
      }),
    ),
  ];
  for (const value of invalid) {
    expect(directZeroBoundFlex(value)).toBe(false);
    const result = await compile({ FlexShapeDefinition: value });
    expect(result.emitters).toHaveLength(0);
    expect(result.unsupported[0].reasons).toContain(
      "flex:untranslated-shape-or-bound-coefficient",
    );
  }
  expect(directZeroBoundFlex(Object.create(flex()))).toBe(false);
  const symbolic = flex();
  symbolic[Symbol("extra")] = 0;
  expect(directZeroBoundFlex(symbolic)).toBe(false);
});

test("conditional Flex does not waive other component dependencies", async () => {
  const result = await compile({
    FlexShapeDefinition: flex(),
    worldAcceleration: {
      __type: "IntegratedValueVector3",
      constantValue: [0, 0, 0],
    },
  });
  expect(result.emitters).toHaveLength(0);
  expect(result.unsupported[0].reasons).toContain("field:worldAcceleration");
});
