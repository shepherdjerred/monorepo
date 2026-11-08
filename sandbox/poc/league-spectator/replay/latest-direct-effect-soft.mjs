// This is a partial material policy, not an implementation of depth fading.
// Original 16e012d..16e019e disables SOFT_PARTICLES for graphics+34b=false;
// the unchanged authored geometry and RNG agree in 968 bounded native frames.
export const DIRECT_SOFT_PARTICLE_POLICY =
  "native-soft-particle-depth-disabled-material-v1";
export const DIRECT_SOFT_PARTICLE_OMISSIONS = Object.freeze([
  "material:soft-particle-depth-intersection-disabled-by-native-graphics-environment",
  "material:original-graphics-setting-provenance-unrecovered",
]);
const policy = Object.freeze({
  policy: DIRECT_SOFT_PARTICLE_POLICY,
  authoredDeltaIn: 100,
  graphics34b: false,
  graphics29c: 0,
});
const ownKeys = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

export function compileDirectDepthDisabledSoftParticles(
  source,
  primitive,
  groundLayer,
) {
  const value = source?.softParticleParams;
  return Object.hasOwn(source ?? {}, "softParticleParams") &&
    ownKeys(value, ["__type", "deltaIn"]) &&
    value.__type === "VfxSoftParticleDefinitionData" &&
    value.deltaIn === 100 &&
    primitive === "arbitrary-quad" &&
    groundLayer === false &&
    source.blendMode === 1 &&
    source.alphaRef === 0
    ? policy
    : null;
}

// The material package is pinned and validated upstream. This extra guard binds
// the partial compiler policy to the exact depth-independent native permutation;
// another shader or graphics policy must never silently acquire this admission.
export function validateDirectDepthDisabledSoftProgram(emitter) {
  if (!Object.hasOwn(emitter.source ?? {}, "softParticleParams")) {
    if (
      emitter.softParticlePolicy != null ||
      emitter.source?.softParticleParams !== undefined
    )
      throw Error("Unexpected compiled soft-particle policy");
    return null;
  }
  const expected = compileDirectDepthDisabledSoftParticles(
    emitter.source,
    emitter.primitive,
    emitter.groundLayer,
  );
  if (
    !expected ||
    !ownKeys(emitter.softParticlePolicy, Object.keys(policy)) ||
    Object.entries(policy).some(
      ([key, value]) => emitter.softParticlePolicy[key] !== value,
    )
  )
    throw Error("Malformed compiled depth-disabled soft-particle policy");
  return expected;
}

export function assertDirectDepthDisabledSoftMaterial(emitter, prepared) {
  if (!validateDirectDepthDisabledSoftProgram(emitter)) return;
  const environment = {
    pass: 0,
    featuresEnabled: true,
    resourceMask: 0,
    systemFogMode: 1,
    graphics34b: false,
    graphics29c: 0,
  };
  const defines = (rows) =>
    Array.isArray(rows) &&
    rows.length === 1 &&
    ownKeys(rows[0], ["name", "value"]) &&
    rows[0].name === "DISABLE_FOW" &&
    rows[0].value === "1";
  if (
    !prepared ||
    `${prepared.effectId}:${prepared.emitterIndex}` !== emitter.materialKey ||
    prepared.family !== "quad" ||
    !ownKeys(prepared.environment, Object.keys(environment)) ||
    Object.entries(environment).some(
      ([key, value]) => prepared.environment[key] !== value,
    ) ||
    !defines(prepared.nativeDefines) ||
    !defines(prepared.defines) ||
    prepared.shaders?.vertex?.sha256 !==
      "5b965c0c3637b1b8324051f9bf1bc4557c43f75d844a94fdd87a66bb3772af4d" ||
    prepared.shaders?.pixel?.sha256 !==
      "19de208150616d57c1f52e50f617a6cf41d378a168d6a574ce93320b356c56c8" ||
    !ownKeys(prepared.textures, [
      "PIXEL_COLOR_REMAP_RAMP_SharedTexture",
      "TEXTURE_TX",
      "PARTICLE_COLOR_TEXTURE_TX",
    ]) ||
    !Array.isArray(prepared.blocks) ||
    prepared.blocks.some((block) =>
      block.sceneMembers?.some((member) =>
        /depthconversion|softparticle/i.test(member.name),
      ),
    )
  )
    throw Error("Exact native depth-disabled soft-particle material required");
}
