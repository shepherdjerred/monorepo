import { expect, test } from "bun:test";
import {
  compileDirectCameraLocalOffsetProgram as compile,
  validateDirectCameraLocalOffsetProgram as validate,
} from "./latest-direct-effect-camera-local.mjs";
const source = () => ({
  particleIsLocalOrientation: 1,
  SpawnShape: { __type: "{ee39916f}", emitOffset: [-85, 0, 0] },
  bindWeight: { __type: "ValueFloat", constantValue: 1 },
});
const emitter = (s = source()) => ({
  source: s,
  primitive: "camera-quad",
  cameraLocalOffsetProgram: compile(s),
  bound: true,
  single: false,
  inheritSystemBasis: !Object.hasOwn(s, "isLocalOrientation"),
  offset: s.SpawnShape.emitOffset.map(Math.fround),
  integratedRotation: null,
  placementRequirements: { rootBasis: true, boundObjectSize: null },
});

test("camera local-offset program preserves the current-root requirement and exact authored flag", () => {
  for (const flag of [0, 1, false, true])
    for (const local of [undefined, 0, false]) {
      const s = {
        ...source(),
        particleIsLocalOrientation: flag,
        ...(local === undefined ? {} : { isLocalOrientation: local }),
      };
      expect(validate(emitter(s))).toEqual({
        schema: 1,
        policy: "native-camera-local-offset-v1",
        useCurrentRootBasis: !!flag,
      });
      expect(s.particleIsLocalOrientation).toBe(flag);
    }
  const explicit = {
    ...source(),
    primitive: { __type: "VfxPrimitiveCameraQuad" },
    EmitterPosition: { __type: "ValueVector3", constantValue: [0, 0, 0] },
  };
  expect(
    validate({ ...emitter(explicit), emitterPosition: [0, 0, 0] }),
  ).not.toBeNull();
});

test("noncamera, unbound, malformed offsets and authored motion retain explicit unsupported gates", () => {
  for (const primitive of ["ray", "arbitrary-quad", "camera-trail", null])
    expect(compile(source(), primitive)).toBeNull();
  for (const value of [
    null,
    Array(3),
    [0, 0],
    [0, 0, 0],
    [1, "0", 0],
    [1, false, 0],
    [Infinity, 0, 0],
    [1e100, 0, 0],
  ])
    expect(
      compile({
        ...source(),
        SpawnShape: { __type: "{ee39916f}", emitOffset: value },
      }),
    ).toBeNull();
  for (const extra of [
    { particleIsLocalOrientation: "true" },
    { isLocalOrientation: true },
    { isSingleParticle: true },
    { bindWeight: { __type: "ValueFloat", constantValue: 0 } },
    { EmitterPosition: undefined },
    { EmitterPosition: { __type: "ValueVector3", constantValue: [0, 1, 0] } },
    { EmitterPosition: { __type: "ValueVector3", constantValue: [0, -0, 0] } },
  ])
    expect(compile({ ...source(), ...extra })).toBeNull();
  for (const key of [
    "birthVelocity",
    "birthRotationalVelocity0",
    "rotation0",
    "isRotationEnabled",
    "birthDrag",
    "drag",
    "acceleration",
    "worldAcceleration",
    "velocity",
    "velocity0",
    "forces",
  ])
    for (const value of [undefined, null, 0, {}])
      expect(compile({ ...source(), [key]: value })).toBeNull();
});

test("compiled camera local-offset metadata fails closed for missing, forged and derived-field corruption", () => {
  const good = emitter();
  for (const cameraLocalOffsetProgram of [
    undefined,
    null,
    {},
    { ...good.cameraLocalOffsetProgram, useCurrentRootBasis: false },
    { ...good.cameraLocalOffsetProgram, extra: 1 },
  ])
    expect(() => validate({ ...good, cameraLocalOffsetProgram })).toThrow();
  for (const extra of [
    { bound: false },
    { single: true },
    { inheritSystemBasis: false },
    { offset: [0, 0, 0] },
    { velocity: [0, 0, 0] },
    { angularVelocity: [0, 0, 0] },
    { integratedRotation: {} },
    { placementRequirements: { rootBasis: false } },
  ])
    expect(() => validate({ ...good, ...extra })).toThrow();
  expect(() => validate({ ...good, primitive: "ray" })).toThrow();
  expect(
    validate({
      source: {},
      primitive: "camera-quad",
      cameraLocalOffsetProgram: null,
    }),
  ).toBeNull();
});

test("inherited required or optional native fields cannot impersonate authored fields", () => {
  for (const key of [
    "particleIsLocalOrientation",
    "SpawnShape",
    "bindWeight",
    "primitive",
    "isLocalOrientation",
    "isSingleParticle",
    "EmitterPosition",
  ]) {
    const complete = {
      ...source(),
      primitive: { __type: "VfxPrimitiveCameraQuad" },
      isLocalOrientation: 0,
      isSingleParticle: 0,
      EmitterPosition: { __type: "ValueVector3", constantValue: [0, 0, 0] },
    };
    const inherited = Object.assign(
      Object.create({ [key]: complete[key] }),
      complete,
    );
    delete inherited[key];
    expect(compile(inherited)).toBeNull();
  }
});
