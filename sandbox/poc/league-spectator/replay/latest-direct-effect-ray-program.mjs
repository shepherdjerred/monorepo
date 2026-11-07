// Bounded original Ray controller contract. Shared birth/emission/value gates
// remain the compiler's responsibility; material selection is separately owned.
const ownKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const unknownControllers = [
  "startFrame",
  "frameRate",
  "birthFrameRate",
  "birthUVOffset",
  "uvMode",
  "birthUvScrollRate",
  "particleUVScrollRate",
  "emitterUvScrollRate",
  "uvRotation",
  "uvScale",
  "textureMult",
  "colorLookUpTypeX",
  "colorLookUpTypeY",
  "colorLookUpScales",
  "colorLookUpOffsets",
  "paletteDefinition",
  "particleIsLocalOrientation",
  "birthRotationalVelocity0",
  "rotation0",
  "isRotationEnabled",
  "birthVelocity",
  "EmitterPosition",
  "softParticleParams",
];
export const DIRECT_RAY_PARTICLE_POLICY = "native-default-ray-particle-v1";

export function compileDirectRayProgram(source) {
  if (
    !ownKeys(source?.primitive, ["__type"]) ||
    source.primitive.__type !== "VfxPrimitiveRay" ||
    !Object.hasOwn(source, "isRandomStartFrame") ||
    ![0, 1, false, true].includes(source.isRandomStartFrame) ||
    !Object.hasOwn(source, "numFrames") ||
    source.numFrames !== 4 ||
    !Object.hasOwn(source, "texDiv") ||
    !Array.isArray(source.texDiv) ||
    source.texDiv.length !== 2 ||
    Reflect.ownKeys(source.texDiv).length !== 3 ||
    !Object.hasOwn(source.texDiv, 0) ||
    !Object.hasOwn(source.texDiv, 1) ||
    source.texDiv[0] !== 4 ||
    source.texDiv[1] !== 1 ||
    typeof source.particleColorTexture !== "string" ||
    source.particleColorTexture.length === 0 ||
    source.particleColorTexture.length > 4096 ||
    source.particleColorTexture.includes("\0") ||
    !Object.hasOwn(source, "isLocalOrientation") ||
    ![0, false].includes(source.isLocalOrientation) ||
    !Object.hasOwn(source, "bindWeight") ||
    !ownKeys(source.bindWeight, ["__type", "constantValue"]) ||
    source.bindWeight.__type !== "ValueFloat" ||
    source.bindWeight.constantValue !== 1 ||
    !Object.hasOwn(source, "SpawnShape") ||
    !ownKeys(source.SpawnShape, ["__type", "emitOffset"]) ||
    source.SpawnShape.__type !== "{ee39916f}" ||
    !Array.isArray(source.SpawnShape.emitOffset) ||
    source.SpawnShape.emitOffset.length !== 3 ||
    Reflect.ownKeys(source.SpawnShape.emitOffset).length !== 4 ||
    ![0, 1, 2].every(
      (i) =>
        Object.hasOwn(source.SpawnShape.emitOffset, i) &&
        Number.isFinite(source.SpawnShape.emitOffset[i]) &&
        Number.isFinite(Math.fround(source.SpawnShape.emitOffset[i])),
    ) ||
    (Object.hasOwn(source, "isUniformScale") &&
      ![0, false].includes(source.isUniformScale)) ||
    (Object.hasOwn(source, "isSingleParticle") &&
      ![0, false].includes(source.isSingleParticle)) ||
    (Object.hasOwn(source, "isGroundLayer") &&
      ![0, false].includes(source.isGroundLayer)) ||
    !Object.hasOwn(source, "particleColorTexture") ||
    unknownControllers.some(
      (key) => Object.hasOwn(source, key) || source[key] !== undefined,
    )
  )
    return null;
  return Object.freeze({
    schema: 1,
    policy: DIRECT_RAY_PARTICLE_POLICY,
    numFrames: 4,
    randomStartFrame: !!source.isRandomStartFrame,
    startFrame: 0,
    frameRate: 0,
    textureDivisions: Object.freeze([4, 1]),
    palette: Object.freeze({
      texture: source.particleColorTexture,
      typeX: 1,
      typeY: 0,
      coefficients: Object.freeze([1, 1, 0, 0]),
    }),
  });
}

export function validateDirectRayProgram(emitter) {
  if (emitter.primitive !== "ray") {
    if (emitter.rayProgram != null)
      throw Error("Unexpected compiled Ray program");
    return null;
  }
  const expected = compileDirectRayProgram(emitter.source),
    actual = emitter.rayProgram;
  const same = (a, b) => {
    if (Array.isArray(b))
      return (
        Array.isArray(a) &&
        Reflect.ownKeys(a).length === b.length + 1 &&
        a.length === b.length &&
        b.every(
          (value, index) => Object.hasOwn(a, index) && same(a[index], value),
        )
      );
    if (b !== null && typeof b === "object")
      return (
        ownKeys(a, Object.keys(b)) &&
        Object.entries(b).every(([key, value]) => same(a[key], value))
      );
    return Object.is(a, b);
  };
  const source = emitter.source;
  if (
    !expected ||
    !same(actual, expected) ||
    emitter.bound !== true ||
    emitter.inheritSystemBasis !== false ||
    emitter.single !== false ||
    emitter.uniformScale !== false ||
    emitter.groundLayer !== false ||
    !same(emitter.offset, source.SpawnShape.emitOffset.map(Math.fround)) ||
    emitter.emitterPosition !== undefined ||
    emitter.velocity !== undefined ||
    emitter.angularVelocity !== undefined ||
    emitter.integratedRotation !== null ||
    emitter.softParticlePolicy !== null ||
    emitter.spriteProgram !== null ||
    emitter.paletteProgram !== null ||
    emitter.paletteTexture !== null ||
    emitter.blend !== (source.blendMode ?? 0) ||
    emitter.delay !== (source.timeBeforeFirstEmission ?? 0) ||
    emitter.lifetime !== Math.fround(source.lifetime) ||
    emitter.rayPaletteTexture?.kind !== "texture" ||
    emitter.rayPaletteTexture.status !== "prepared" ||
    typeof emitter.rayPaletteTexture.file !== "string" ||
    !emitter.rayPaletteTexture.file.length ||
    emitter.rayPaletteTexture.file.startsWith("/") ||
    emitter.rayPaletteTexture.file.includes("..") ||
    emitter.rayPaletteTexture.file.includes("\0") ||
    !/^[0-9a-f]{64}$/.test(emitter.rayPaletteTexture.sha256 ?? "")
  )
    throw Error("Malformed compiled default Ray particle program");
  return expected;
}
