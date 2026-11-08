import { directTrailHalf } from "./latest-direct-effect-trail.mjs";
import { DIRECT_GROUND_POLICY } from "./latest-direct-ground-contract.mjs";
import { validateDirectRayProgram } from "./latest-direct-effect-ray-program.mjs";

const ownKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const controls = [
  "startFrame",
  "frameRate",
  "birthFrameRate",
  "texDiv",
  "birthUVOffset",
  "uvMode",
  "birthUvScrollRate",
  "particleUVScrollRate",
  "emitterUvScrollRate",
  "uvRotation",
  "uvScale",
  "textureMult",
];

// Bounded controller slice: original constructor clocks/divisions and a typed
// four-frame declaration. Animated frame clocks and UV transforms stay outside.
export function compileDirectQuadSprite(source, primitive) {
  if (
    primitive !== "arbitrary-quad" ||
    !Object.hasOwn(source ?? {}, "isRandomStartFrame") ||
    !Object.hasOwn(source, "numFrames") ||
    ![0, 1, false, true].includes(source.isRandomStartFrame) ||
    source.numFrames !== 4 ||
    controls.some((key) => Object.hasOwn(source, key))
  )
    return null;
  return Object.freeze({
    numFrames: 4,
    randomStartFrame: !!source.isRandomStartFrame,
    startFrame: 0,
    frameRate: 0,
  });
}

export function validateDirectQuadSpriteProgram(emitter) {
  if (emitter.primitive === "ray") {
    validateDirectRayProgram(emitter);
    if (emitter.spriteProgram != null)
      throw Error("Unexpected compiled quad sprite program on Ray");
    return null;
  }
  const source = emitter.source ?? {};
  if (
    emitter.primitive === "camera-trail" ||
    (!Object.hasOwn(source, "isRandomStartFrame") &&
      !Object.hasOwn(source, "numFrames"))
  ) {
    if (emitter.spriteProgram != null)
      throw Error("Unexpected compiled quad sprite program");
    return null;
  }
  const expected = compileDirectQuadSprite(source, emitter.primitive);
  if (
    !expected ||
    !ownKeys(emitter.spriteProgram, Object.keys(expected)) ||
    Object.entries(expected).some(
      ([key, value]) => emitter.spriteProgram[key] !== value,
    )
  )
    throw Error("Malformed compiled four-frame quad sprite program");
  return expected;
}

// Original 175f697..175f6e5 reuses the retained birth chance. This calculation
// does not sample RNG; native per-particle frameRate/startFrame are both zero.
export function directQuadSpriteFrame(program, chance) {
  if (
    program?.numFrames !== 4 ||
    typeof program.randomStartFrame !== "boolean" ||
    program.startFrame !== 0 ||
    program.frameRate !== 0 ||
    typeof chance !== "number" ||
    !Number.isFinite(chance) ||
    chance < 0 ||
    chance > 1
  )
    throw Error("Invalid bounded quad sprite frame input");
  const frame = program.randomStartFrame
    ? Math.fround(Math.fround(Math.fround(chance) * 4) % 4)
    : 0;
  return Math.fround(0 + frame);
}

// Quad and trail writers share original 1731fb0's half conversion.
export function directQuadSpriteFrameHalf(program, chance) {
  return directTrailHalf(directQuadSpriteFrame(program, chance));
}

// The bounded controller proof does not authorize arbitrary shader resources.
// This first material slice uses the original exclusive ground pass observed
// with authored four-frame quads and constructor-default texture divisions.
export function directQuadSpriteMaterialSubset(source, groundLayer) {
  return (
    groundLayer === true &&
    source.blendMode === 4 &&
    !Object.hasOwn(source, "alphaRef")
  );
}

export function assertDirectQuadSpriteMaterial(emitter, prepared) {
  if (!validateDirectQuadSpriteProgram(emitter)) return;
  const environment = {
    pass: 5,
    featuresEnabled: true,
    resourceMask: 0,
    systemFogMode: 0,
    graphics34b: false,
    graphics29c: 0,
  };
  const defines = (rows) =>
    Array.isArray(rows) &&
    rows.length === 1 &&
    ownKeys(rows[0], ["name", "value"]) &&
    rows[0].name === "ALPHA_TEST" &&
    rows[0].value === "1";
  const globals = prepared?.blocks?.filter((b) => b.glslName === "Globals_vs");
  const pixel = prepared?.blocks?.filter((b) => b.glslName === "Globals_ps");
  if (
    !directQuadSpriteMaterialSubset(emitter.source, emitter.groundLayer) ||
    emitter.materialPolicy !== DIRECT_GROUND_POLICY ||
    !prepared ||
    `${prepared.effectId}:${prepared.emitterIndex}` !== emitter.materialKey ||
    prepared.family !== "quad" ||
    prepared.materialPolicy !== DIRECT_GROUND_POLICY ||
    !ownKeys(prepared.environment, Object.keys(environment)) ||
    Object.entries(environment).some(
      ([k, v]) => prepared.environment[k] !== v,
    ) ||
    !defines(prepared.nativeDefines) ||
    !defines(prepared.defines) ||
    prepared.shaders?.vertex?.sha256 !==
      "924cda2a7adbe0a9b2e7c7fcd6fc459f08694dd55bb17fa73441d98dd2691afe" ||
    prepared.shaders?.pixel?.sha256 !==
      "6c8919d2888115e1acf410b50631b4bf8b471a9412884e2c2507843c95a164b6" ||
    globals?.length !== 1 ||
    globals[0].size !== 32 ||
    globals[0].bytesHex !==
      "0000803f0000803f0000803f0000000000000000000000000000000000000000" ||
    globals[0].sceneMembers?.length !== 0 ||
    pixel?.length !== 1 ||
    pixel[0].size !== 16 ||
    pixel[0].bytesHex !== "a1a0a03c000000000000000000000000" ||
    pixel[0].sceneMembers?.length !== 0 ||
    JSON.stringify(prepared.nativeBlendFactors) !== "[6,6,1,1]"
  )
    throw Error("Exact native four-frame ground quad material required");
}
