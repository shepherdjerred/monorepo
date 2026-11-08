import { expect, test } from "bun:test";
import {
  compileMissileEffectBasisProgram,
  compileTrackingFixedSpeedEffectBasisProgram,
  validateMissileEffectBasisProgram,
  validateMissileEffectBasisStates,
  zeroTurnMissileEffectBasis,
} from "./latest-missile-effect-basis.mjs";
const source = {
  spellHash: 123,
  spellName: "fixture",
  catalogSha256: "a".repeat(64),
};
const spell = {
  mMissileSpec: { movementComponent: { __type: "FixedTimeMovement" } },
};

test("zero-turn source admission preserves explicit authored values and requires the exact fixed-time catalog provenance", () => {
  const p = compileMissileEffectBasisProgram(spell, source);
  expect(p.catalogSha256).toBe(source.catalogSha256);
  expect(Object.isFrozen(p)).toBe(true);
  expect(compileMissileEffectBasisProgram(spell, {})).toBeNull();
  expect(
    compileMissileEffectBasisProgram(
      { mMissileSpec: { movementComponent: { __type: "FixedSpeedMovement" } } },
      source,
    ),
  ).toBeNull();
  for (const field of [
    "MissileEffectMaxTurnSpeedDegreesPerSecond",
    "MissileEffectMaximumAngleDegrees",
  ]) {
    for (const value of [1, false, null, undefined, "0", NaN, Infinity])
      expect(
        compileMissileEffectBasisProgram({ ...spell, [field]: value }, source),
      ).toBeNull();
    expect(
      compileMissileEffectBasisProgram({ ...spell, [field]: 0 }, source),
    ).toEqual(p);
  }
});

test("original missile setter uses local Y along velocity and preserves its singular native down/zero outcomes", () => {
  expect(zeroTurnMissileEffectBasis([0, 1, 0]).basis).toEqual([
    1, 0, 0, 0, 1, 0, 0, 0, 1,
  ]);
  expect(zeroTurnMissileEffectBasis([1, 0, 0]).basis).toEqual([
    0, 0, 1, 1, 0, 0, 0, 1, 0,
  ]);
  const zero = zeroTurnMissileEffectBasis([0, 0, 0]);
  expect(zero.basis.every((lane) => lane === 0)).toBe(true);
  const down = zeroTurnMissileEffectBasis([0, -1, 0]);
  expect(down.basis[4]).toBe(-1);
  expect(
    down.basis.filter((_, index) => index !== 4).every((lane) => lane === 0),
  ).toBe(true);
  for (const value of [
    null,
    [],
    [1, 2],
    [1, 2, Infinity],
    [1, 2, "3"],
    [1e100, 0, 0],
  ])
    expect(() => zeroTurnMissileEffectBasis(value)).toThrow();
});

test("retained serialized basis must match callback inputs and may not reorient after movement stops", () => {
  const program = compileMissileEffectBasisProgram(spell, source),
    basis = zeroTurnMissileEffectBasis([1, 2, 3]).basis;
  const states = [
    { velocity: [1, 2, 3], stopped: false, effectBasis: basis },
    { velocity: [0, 0, 0], stopped: true, effectBasis: [...basis] },
  ];
  expect(() =>
    validateMissileEffectBasisStates(program, states, source),
  ).not.toThrow();
  for (const change of [
    { turnSpeed: 1 },
    { maximumAngle: null },
    { schema: 2 },
    { catalogSha256: "" },
    { movementType: "UnknownMovement" },
    { extra: true },
  ])
    expect(() =>
      validateMissileEffectBasisProgram({ ...program, ...change }, source),
    ).toThrow();
  const changed = structuredClone(states);
  changed[1].effectBasis = zeroTurnMissileEffectBasis([0, 0, 0]).basis;
  expect(() =>
    validateMissileEffectBasisStates(program, changed, source),
  ).toThrow();
  expect(() =>
    validateMissileEffectBasisStates(
      program,
      [
        {
          velocity: [0, 0, 0],
          stopped: false,
          effectBasis: zeroTurnMissileEffectBasis([0, 0, 0]).basis,
        },
      ],
      source,
    ),
  ).toThrow();
});

test("tracking FixedSpeed basis preserves its named type1 source/default visibility boundary", () => {
  const data = {
    mCastType: 1,
    mMissileSpec: {
      __type: "MissileSpecification",
      movementComponent: {
        __type: "FixedSpeedMovement",
        mStartBoneName: "owned-installed-bone",
      },
    },
  };
  const program = compileTrackingFixedSpeedEffectBasisProgram(data, source);
  expect(program.movementType).toBe("FixedSpeedMovement");
  expect(Object.isFrozen(program)).toBe(true);
  expect(() =>
    validateMissileEffectBasisProgram(program, {
      ...source,
      movementType: "FixedTimeMovement",
    }),
  ).toThrow();
  for (const change of [
    { mTracksTarget: false },
    { mTracksTarget: null },
    { mTargetBoneName: "target-bone" },
    { mTargetBoneName: null },
    { mStartBoneName: "" },
    { mStartBoneName: null },
    { __type: "FixedTimeMovement" },
  ])
    expect(
      compileTrackingFixedSpeedEffectBasisProgram(
        {
          ...data,
          mMissileSpec: {
            ...data.mMissileSpec,
            movementComponent: {
              ...data.mMissileSpec.movementComponent,
              ...change,
            },
          },
        },
        source,
      ),
    ).toBeNull();
  for (const castType of [0, 3, null])
    expect(
      compileTrackingFixedSpeedEffectBasisProgram(
        { ...data, mCastType: castType },
        source,
      ),
    ).toBeNull();
  expect(
    compileTrackingFixedSpeedEffectBasisProgram(
      {
        ...data,
        mMissileSpec: { ...data.mMissileSpec, unknownVisibility: false },
      },
      source,
    ),
  ).toBeNull();
  for (const field of [
    "MissileEffectMaxTurnSpeedDegreesPerSecond",
    "MissileEffectMaximumAngleDegrees",
  ])
    for (const value of [1, -0, null, false, NaN])
      expect(
        compileTrackingFixedSpeedEffectBasisProgram(
          { ...data, [field]: value },
          source,
        ),
      ).toBeNull();
});
