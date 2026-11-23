import { expect, test } from "bun:test";
import {
  compileDirectArbitraryLocalOrientationProgram as compile,
  validateDirectArbitraryLocalOrientationProgram as validate,
} from "./latest-direct-effect-arbitrary-local.mjs";
const source = () => ({
  __type: "VfxEmitterDefinitionData",
  primitive: { __type: "VfxPrimitiveArbitraryQuad" },
  particleIsLocalOrientation: 1,
  isSingleParticle: 1,
  bindWeight: { __type: "ValueFloat", constantValue: 1 },
  birthRotation0: { __type: "ValueVector3", constantValue: [90, 40, 0] },
  EmitterPosition: { __type: "ValueVector3", constantValue: [-150, 0, 150] },
});
const emitter = () => {
  const value = source();
  return {
    source: value,
    primitive: "arbitrary-quad",
    arbitraryLocalOrientationProgram: compile(value),
    bound: true,
    single: true,
    inheritSystemBasis: true,
    offset: [0, 0, 0],
    emitterPosition: [-150, 0, 150],
    placementRequirements: { rootBasis: true },
  };
};
test("bounded original single bound arbitrary particle requires current basis for axes and position", () => {
  const value = emitter();
  expect(compile(value.source)).toEqual({
    schema: 1,
    policy: "native-arbitrary-local-orientation-v1",
    useCurrentRootBasisForAxes: true,
    useCurrentRootBasisForPosition: true,
  });
  expect(validate(value)).toEqual(compile(value.source));
  for (const [key, supplied] of [
    ["SpawnShape", {}],
    ["birthVelocity", { __type: "ValueVector3", constantValue: [0, 0, 0] }],
    ["isLocalOrientation", false],
    ["rotation0", {}],
    ["particleIsLocalOrientation", false],
    ["isSingleParticle", false],
    ["birthRotation0", { __type: "ValueVector3", dynamics: {} }],
    ["EmitterPosition", { __type: "ValueVector3", constantValue: [NaN, 0, 0] }],
  ])
    expect(compile({ ...source(), [key]: supplied })).toBeNull();
  expect(compile(source(), "camera-quad")).toBeNull();
});
test("compiled local-orientation promises and placement cannot be forged", () => {
  for (const alter of [
    (e) => delete e.arbitraryLocalOrientationProgram,
    (e) =>
      (e.arbitraryLocalOrientationProgram.useCurrentRootBasisForAxes = false),
    (e) =>
      (e.arbitraryLocalOrientationProgram.useCurrentRootBasisForPosition = false),
    (e) => (e.arbitraryLocalOrientationProgram.extra = true),
    (e) => (e.bound = false),
    (e) => (e.single = false),
    (e) => (e.inheritSystemBasis = false),
    (e) => (e.offset = [0, 0, 1]),
    (e) => (e.emitterPosition = [0, 0, 0]),
    (e) => (e.velocity = [0, 0, 0]),
    (e) => (e.placementRequirements.rootBasis = false),
  ]) {
    const value = emitter();
    value.arbitraryLocalOrientationProgram = {
      ...value.arbitraryLocalOrientationProgram,
    };
    alter(value);
    expect(() => validate(value)).toThrow();
  }
});

test("unbound local axes preserve the birth-world origin without admitting authored offsets", () => {
  const value = emitter();
  value.source.bindWeight.constantValue = 0;
  delete value.source.EmitterPosition;
  delete value.emitterPosition;
  value.bound = false;
  value.arbitraryLocalOrientationProgram = compile(value.source);
  expect(value.arbitraryLocalOrientationProgram).toEqual({
    schema: 2,
    policy: "native-arbitrary-local-orientation-v1",
    useCurrentRootBasisForAxes: true,
    useCurrentRootBasisForPosition: false,
    positionPolicy: "retained-birth-world-origin",
  });
  expect(validate(value)).toEqual(compile(value.source));
  for (const offset of [
    [0, 0, 0],
    [-150, 0, 150],
  ])
    expect(
      compile({
        ...value.source,
        EmitterPosition: { __type: "ValueVector3", constantValue: offset },
      }),
    ).toBeNull();
  for (const bind of [-0, 0.5, false, null, NaN, Infinity])
    expect(
      compile({
        ...value.source,
        bindWeight: { __type: "ValueFloat", constantValue: bind },
      }),
    ).toBeNull();
  for (const change of [
    (e) => {
      e.bound = true;
    },
    (e) => {
      e.arbitraryLocalOrientationProgram.positionPolicy = "current-root";
    },
    (e) => {
      e.arbitraryLocalOrientationProgram.useCurrentRootBasisForPosition = true;
    },
    (e) => {
      e.offset = [1, 0, 0];
    },
    (e) => {
      e.emitterPosition = [0, 0, 0];
    },
  ]) {
    const forged = structuredClone(value);
    change(forged);
    expect(() => validate(forged)).toThrow();
  }
});

test("inherited native source fields cannot impersonate authored declarations", () => {
  for (const name of [
    "__type",
    "primitive",
    "particleIsLocalOrientation",
    "isSingleParticle",
    "bindWeight",
    "birthRotation0",
    "EmitterPosition",
  ]) {
    const value = source(),
      inherited = value[name];
    delete value[name];
    Object.setPrototypeOf(value, { [name]: inherited });
    expect(compile(value)).toBeNull();
  }
});
