import { expect, test } from "bun:test";
import {
  compileDirectLegacyOffsetProgram as compile,
  validateDirectLegacyOffsetProgram as validate,
  sampleDirectLegacyOffset as sample,
} from "./latest-direct-effect-legacy-offset.mjs";
const shape = () => ({
  __type: "VfxShapeLegacy",
  emitOffset: { __type: "ValueVector3", constantValue: [1, 2, 3] },
});
const emitter = (s = shape()) => ({
  source: { SpawnShape: s },
  primitive: "arbitrary-quad",
  legacyOffsetProgram: compile(s, "arbitrary-quad"),
  offset: null,
  placementRequirements: { rootBasis: true, boundObjectSize: null },
});
test("Legacy offset program preserves exact source curves and normalized emitter clock", () => {
  for (const primitive of ["camera-quad", "arbitrary-quad"]) {
    const s = shape(),
      p = compile(s, primitive);
    expect(p).toEqual({
      schema: 1,
      policy: "native-legacy-offset-v1",
      clock: "normalized-emitter-age",
      field: s.emitOffset,
    });
    s.emitOffset.constantValue[0] = 99;
    expect(p.field.constantValue[0]).toBe(1);
  }
  const d = {
    __type: "VfxShapeLegacy",
    emitOffset: {
      __type: "ValueVector3",
      constantValue: [0, -100, -40],
      dynamics: {
        __type: "VfxAnimatedVector3fVariableData",
        times: [0, 0.7],
        values: [
          [0, -100, 0],
          [0, -150, 0],
        ],
      },
    },
  };
  expect(validate(emitter(d))).not.toBeNull();
  let observed;
  expect(
    sample(compile(d, "arbitrary-quad"), 0.25, {
      sample: (...args) => {
        observed = args;
        return [1, 2, 3];
      },
    }),
  ).toEqual([1, 2, 3]);
  expect(observed).toEqual([d.emitOffset, Math.fround(0.25), [0, 0, 0]]);
});
test("Legacy shape admission keeps rotation, RNG, unknown fields and malformed curves blocked", () => {
  for (const primitive of ["ray", "camera-trail", "static-mesh", undefined])
    expect(compile(shape(), primitive)).toBeNull();
  for (const extra of [
    { emitRotationAngles: [] },
    { emitRotationAxes: [] },
    { unknown: 0 },
  ])
    expect(compile({ ...shape(), ...extra }, "arbitrary-quad")).toBeNull();
  for (const emitOffset of [
    null,
    undefined,
    {},
    [0, 0, 0],
    { __type: "ValueVector3" },
    { __type: "ValueVector3", constantValue: [1, 2, "3"] },
  ])
    expect(compile({ ...shape(), emitOffset }, "arbitrary-quad")).toBeNull();
  const dynamics = {
    __type: "VfxAnimatedVector3fVariableData",
    times: [0, 1],
    values: [
      [0, 0, 0],
      [1, 2, 3],
    ],
  };
  for (const extra of [
    { times: [] },
    { times: [1, 0] },
    { times: [0, 0] },
    { values: Array(2) },
    { unknown: 1 },
    {
      probabilityTables: [
        { __type: "VfxProbabilityTableData", singleValue: 1 },
        { __type: "VfxProbabilityTableData" },
        { __type: "VfxProbabilityTableData" },
      ],
    },
  ])
    expect(
      compile(
        {
          ...shape(),
          emitOffset: {
            __type: "ValueVector3",
            dynamics: { ...dynamics, ...extra },
          },
        },
        "arbitrary-quad",
      ),
    ).toBeNull();
});
test("Legacy metadata rejects missing, forged, wrong-clock and source-mismatched fields", () => {
  const e = emitter();
  expect(validate(e)).not.toBeNull();
  for (const extra of [
    { legacyOffsetProgram: null },
    { legacyOffsetProgram: undefined },
    {
      legacyOffsetProgram: { ...e.legacyOffsetProgram, clock: "particle-age" },
    },
    {
      legacyOffsetProgram: {
        ...e.legacyOffsetProgram,
        field: { __type: "ValueVector3", constantValue: [4, 5, 6] },
      },
    },
    { offset: [0, 0, 0] },
    { placementRequirements: { rootBasis: false } },
    { primitive: "ray" },
  ])
    expect(() => validate({ ...e, ...extra })).toThrow();
  expect(
    validate({
      source: {},
      primitive: "arbitrary-quad",
      legacyOffsetProgram: null,
    }),
  ).toBeNull();
  for (const value of [null, NaN, Infinity, "0"])
    expect(() =>
      sample(e.legacyOffsetProgram, value, { sample: () => [0, 0, 0] }),
    ).toThrow();
});
