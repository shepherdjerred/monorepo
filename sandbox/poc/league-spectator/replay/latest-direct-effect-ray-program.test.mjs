import { expect, test } from "bun:test";
import {
  compileDirectRayProgram,
  validateDirectRayProgram,
} from "./latest-direct-effect-ray-program.mjs";
import { directRayRetainedParticle } from "./latest-direct-effect-ray-draw.mjs";
const source = () => ({
  primitive: { __type: "VfxPrimitiveRay" },
  isRandomStartFrame: 1,
  numFrames: 4,
  texDiv: [4, 1],
  particleColorTexture: "ASSETS/Particles/palette.tex",
  isLocalOrientation: 0,
  bindWeight: { __type: "ValueFloat", constantValue: 1 },
  SpawnShape: { __type: "{ee39916f}", emitOffset: [0, 50, 0] },
  lifetime: 1,
});
const emitter = (s = source()) => ({
  primitive: "ray",
  source: s,
  rayProgram: compileDirectRayProgram(s),
  bound: true,
  inheritSystemBasis: false,
  single: false,
  uniformScale: false,
  groundLayer: false,
  offset: s.SpawnShape.emitOffset.map(Math.fround),
  integratedRotation: null,
  softParticlePolicy: null,
  spriteProgram: null,
  paletteProgram: null,
  paletteTexture: null,
  blend: s.blendMode ?? 0,
  delay: s.timeBeforeFirstEmission ?? 0,
  lifetime: Math.fround(s.lifetime),
  rayPaletteTexture: {
    kind: "texture",
    status: "prepared",
    file: "textures/palette.png",
    sha256: "1".repeat(64),
  },
});
test("Ray controller retains exact authored atlas and default palette without consuming RNG", () => {
  const s = source(),
    program = compileDirectRayProgram(s);
  expect(program.randomStartFrame).toBe(true);
  expect(program.textureDivisions).toEqual([4, 1]);
  expect(program.palette.texture).toBe(s.particleColorTexture);
  expect(
    validateDirectRayProgram({
      ...emitter(s),
      rayProgram: structuredClone(program),
    }),
  ).toEqual(program);
  const input = {
      birthBasis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      birthOrigin: [-2, 0, 1],
      motion: [0, 50, 0],
      rootPosition: [10, 20, 30],
      bound: true,
      rotation: [0, 0, 0],
      birthScale: [2, 3, 4],
      sampledScale: [1, 2, 0],
      birthColor: [1, 0.5, 0.25, 0.5],
      sampledColor: [1, 1, 1, 0.5],
      fraction: 0.25,
      chance: 0.375,
      rayProgram: program,
    },
    before = structuredClone(input),
    out = directRayRetainedParticle(input);
  expect(Array.from(out.position)).toEqual([8, 70, 31]);
  expect(Array.from(out.axis)).toEqual([0, 0, 1]);
  expect(Array.from(out.attributes)).toEqual([
    1.5, 1, 0.5, 0.25, 0.25, 2, 6, 0, 0.25, 1, 0,
  ]);
  expect(input).toEqual(before);
  out.position.fill(100);
  expect(Array.from(directRayRetainedParticle(input).position)).toEqual([
    8, 70, 31,
  ]);
});
test("Ray source and compiled metadata reject unknown controllers, malformed atlas and forged defaults", () => {
  for (const mutate of [
    (s) => (s.primitive.__type = "VfxPrimitiveCameraQuad"),
    (s) => (s.primitive.extra = 0),
    (s) => (s.numFrames = 8),
    (s) => (s.texDiv = [1, 1]),
    (s) => (s.texDiv = Array(2)),
    (s) => (s.isRandomStartFrame = "1"),
    (s) => (s.particleColorTexture = null),
    (s) => (s.particleColorTexture = "bad\0texture"),
    (s) => (s.frameRate = 0),
    (s) => (s.uvScale = [1, 1]),
    (s) => (s.textureMult = "asset.tex"),
    (s) => (s.colorLookUpTypeX = 1),
    (s) =>
      (s.birthVelocity = { __type: "ValueVector3", constantValue: [0, 0, 0] }),
    (s) => (s.isUniformScale = true),
    (s) => (s.isSingleParticle = true),
    (s) => (s.rotation0 = {}),
    (s) => (s.EmitterPosition = {}),
    (s) => (s.isLocalOrientation = 1),
    (s) => delete s.isLocalOrientation,
    (s) => (s.bindWeight.constantValue = 0),
    (s) => (s.SpawnShape.emitOffset = Array(3)),
    (s) => (s.SpawnShape.emitOffset[0] = "0"),
  ]) {
    const s = source();
    mutate(s);
    expect(compileDirectRayProgram(s)).toBeNull();
  }
  const s = source(),
    p = compileDirectRayProgram(s);
  for (const mutate of [
    (p) => (p.numFrames = 8),
    (p) => (p.palette.typeX = 0),
    (p) => (p.textureDivisions = [1, 1]),
    (p) => (p.palette.coefficients[2] = -0),
    (p) => delete p.palette,
    (p) => (p.unknown = 0),
  ]) {
    const altered = structuredClone(p);
    mutate(altered);
    expect(() =>
      validateDirectRayProgram({ ...emitter(s), rayProgram: altered }),
    ).toThrow();
  }
  expect(() =>
    validateDirectRayProgram({ primitive: "ray", source: s }),
  ).toThrow();
  expect(() =>
    validateDirectRayProgram({
      primitive: "camera-quad",
      source: s,
      rayProgram: p,
    }),
  ).toThrow();
  expect(
    validateDirectRayProgram({ primitive: "camera-quad", source: {} }),
  ).toBeNull();
});
test("Ray derived particle fields and palette readiness cannot be forged independently of authored source", () => {
  for (const mutate of [
    (e) => (e.bound = false),
    (e) => (e.inheritSystemBasis = true),
    (e) => (e.single = true),
    (e) => (e.uniformScale = true),
    (e) => (e.offset[1] = 0),
    (e) => (e.emitterPosition = [1, 0, 0]),
    (e) => (e.velocity = [0, 0, 0]),
    (e) => (e.angularVelocity = [0, 0, 0]),
    (e) => (e.integratedRotation = {}),
    (e) => (e.softParticlePolicy = {}),
    (e) => (e.spriteProgram = {}),
    (e) => (e.paletteProgram = {}),
    (e) => (e.blend = 4),
    (e) => (e.delay = 0.1),
    (e) => (e.lifetime = 2),
    (e) => (e.rayPaletteTexture = null),
    (e) => (e.rayPaletteTexture.sha256 = "bad"),
    (e) => (e.rayPaletteTexture.file = "../palette.png"),
    (e) => (e.rayPaletteTexture.status = "missing"),
  ]) {
    const e = emitter();
    mutate(e);
    expect(() => validateDirectRayProgram(e)).toThrow();
  }
});
test("Ray draw inputs require finite owned typed particle values without coercion or guessed pose", () => {
  const make = () => ({
    birthBasis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    birthOrigin: [0, 0, 0],
    motion: [0, 0, 0],
    rootPosition: [0, 0, 0],
    bound: true,
    rotation: [0, 0, 0],
    birthScale: [1, 1, 1],
    sampledScale: [1, 1, 1],
    birthColor: [1, 1, 1, 1],
    sampledColor: [1, 1, 1, 1],
    fraction: 0,
    chance: 0.5,
    rayProgram: compileDirectRayProgram(source()),
  });
  for (const mutate of [
    (v) => (v.birthBasis = null),
    (v) => (v.rootPosition[0] = "0"),
    (v) => (v.birthOrigin[0] = null),
    (v) => (v.motion = Array(3)),
    (v) => (v.bound = 1),
    (v) => (v.fraction = Infinity),
    (v) => (v.chance = 1.1),
  ]) {
    const v = make();
    mutate(v);
    expect(() => directRayRetainedParticle(v)).toThrow();
  }
});
