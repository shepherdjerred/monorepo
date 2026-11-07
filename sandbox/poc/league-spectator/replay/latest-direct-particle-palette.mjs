import { directTrailHalf } from "./latest-direct-effect-trail.mjs";
import { validateDirectRayProgram } from "./latest-direct-effect-ray-program.mjs";

const ownKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((k) => Object.hasOwn(value, k));
const authoredControls = [
  "colorLookUpTypeX",
  "colorLookUpTypeY",
  "colorLookUpScales",
  "colorLookUpOffsets",
  "paletteDefinition",
];

// Original default palette modes: X=normalized particle age, Y=constant one.
// Authored palette modes/scales/offsets remain untranslated source fields.
export function compileDirectParticlePalette(source, primitive, groundLayer) {
  const texture = source?.particleColorTexture;
  if (
    !Object.hasOwn(source ?? {}, "particleColorTexture") ||
    typeof texture !== "string" ||
    texture.length === 0 ||
    texture.length > 4096 ||
    texture.includes("\0") ||
    primitive !== "camera-quad" ||
    groundLayer !== false ||
    source.blendMode !== 0 ||
    Object.hasOwn(source, "alphaRef") ||
    authoredControls.some(
      (key) => Object.hasOwn(source, key) || source[key] !== undefined,
    )
  )
    return null;
  return Object.freeze({
    texture,
    typeX: 1,
    typeY: 0,
    coefficients: Object.freeze([1, 1, 0, 0]),
  });
}

export function validateDirectParticlePaletteProgram(emitter) {
  if (emitter.primitive === "ray") {
    validateDirectRayProgram(emitter);
    if (emitter.paletteProgram != null || emitter.paletteTexture != null)
      throw Error("Unexpected compiled quad palette program on Ray");
    return null;
  }
  if (!Object.hasOwn(emitter.source ?? {}, "particleColorTexture")) {
    if (
      emitter.paletteProgram != null ||
      emitter.paletteTexture != null ||
      emitter.source?.particleColorTexture !== undefined
    )
      throw Error("Unexpected compiled particle palette program");
    return null;
  }
  const expected = compileDirectParticlePalette(
      emitter.source,
      emitter.primitive,
      emitter.groundLayer,
    ),
    actual = emitter.paletteProgram;
  if (
    !expected ||
    !ownKeys(actual, Object.keys(expected)) ||
    actual.texture !== expected.texture ||
    actual.typeX !== 1 ||
    actual.typeY !== 0 ||
    !Array.isArray(actual.coefficients) ||
    actual.coefficients.length !== 4 ||
    Reflect.ownKeys(actual.coefficients).length !== 5 ||
    ![0, 1, 2, 3].every(
      (i) =>
        Object.hasOwn(actual.coefficients, i) &&
        Object.is(actual.coefficients[i], expected.coefficients[i]),
    ) ||
    emitter.paletteTexture?.kind !== "texture" ||
    emitter.paletteTexture.status !== "prepared" ||
    typeof emitter.paletteTexture.file !== "string" ||
    emitter.paletteTexture.file.length === 0 ||
    emitter.paletteTexture.file.startsWith("/") ||
    emitter.paletteTexture.file.includes("..") ||
    emitter.paletteTexture.file.includes("\0") ||
    !/^[a-f0-9]{64}$/.test(emitter.paletteTexture.sha256 ?? "")
  )
    throw Error("Malformed compiled default particle palette program");
  return expected;
}

export function assertDirectParticlePaletteMaterial(emitter, prepared) {
  if (!validateDirectParticlePaletteProgram(emitter)) return;
  const env = {
      pass: 0,
      featuresEnabled: true,
      resourceMask: 0,
      systemFogMode: 1,
      graphics34b: false,
      graphics29c: 0,
    },
    defines = (rows) =>
      Array.isArray(rows) &&
      rows.length === 2 &&
      rows.every((r) => ownKeys(r, ["name", "value"]) && r.value === "1") &&
      new Set(rows.map((r) => r.name)).size === 2 &&
      rows.some((r) => r.name === "ALPHA_TEST") &&
      rows.some((r) => r.name === "DISABLE_FOW"),
    texture = prepared?.textures?.PARTICLE_COLOR_TEXTURE_TX,
    expected = emitter.paletteTexture,
    globals = prepared?.blocks?.filter((b) => b.glslName === "Globals_vs"),
    pixel = prepared?.blocks?.filter((b) => b.glslName === "Globals_ps");
  if (
    !prepared ||
    `${prepared.effectId}:${prepared.emitterIndex}` !== emitter.materialKey ||
    prepared.family !== "quad" ||
    !ownKeys(prepared.environment, Object.keys(env)) ||
    Object.entries(env).some(([k, v]) => prepared.environment[k] !== v) ||
    !defines(prepared.nativeDefines) ||
    !defines(prepared.defines) ||
    prepared.shaders?.vertex?.sha256 !==
      "5b965c0c3637b1b8324051f9bf1bc4557c43f75d844a94fdd87a66bb3772af4d" ||
    prepared.shaders?.pixel?.sha256 !==
      "66fb44fe736a476b8b3676a855f41b460d423c324423b46bcd6671eca07c8574" ||
    expected?.kind !== "texture" ||
    expected.status !== "prepared" ||
    texture?.kind !== "prepared-texture" ||
    texture.file !== expected.file ||
    texture.sha256 !== expected.sha256 ||
    texture.nativeSamplerHex !== "0101010101" ||
    texture.sampler?.name !== "clamp" ||
    texture.sampler.pixelated !== false ||
    globals?.length !== 1 ||
    globals[0].size !== 32 ||
    globals[0].bytesHex !==
      "0000803f0000803f0000803f0000000000000000000000000000000000000000" ||
    globals[0].sceneMembers?.length !== 0 ||
    pixel?.length !== 1 ||
    pixel[0].size !== 16 ||
    pixel[0].bytesHex !== "a1a0a03c000000000000000000000000" ||
    pixel[0].sceneMembers?.length !== 0 ||
    JSON.stringify(prepared.nativeBlendFactors) !== "[1,1,1,1]"
  )
    throw Error("Exact native default particle palette material required");
}

export function directDefaultParticlePalette(fraction) {
  if (
    typeof fraction !== "number" ||
    !Number.isFinite(fraction) ||
    fraction < 0 ||
    fraction > 1
  )
    throw Error("Explicit live particle age fraction required");
  const x = Math.fround(Math.fround(Math.fround(fraction) * 1) + 0);
  return new Uint16Array([directTrailHalf(x), directTrailHalf(1)]);
}
