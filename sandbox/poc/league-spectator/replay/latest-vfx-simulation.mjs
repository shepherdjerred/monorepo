import { decodeLatestVfxQuadVertices } from "./latest-vfx-quad-vertices.mjs";

// A declared preview subset, not the full League emitter engine. No substitute
// textures, unknown shape guesses or synthetic random draws are used.
const coreFields = new Set([
  "__type",
  "emitterName",
  "importance",
  "pass",
  "isSingleParticle",
  "rate",
  "particleLifetime",
  "lifetime",
  "birthColor",
  "Color",
  "birthScale0",
  "scale0",
  "birthRotation0",
  "bindWeight",
  "SpawnShape",
  "primitive",
  "blendMode",
  "miscRenderFlags",
  "disableBackfaceCull",
  "isUniformScale",
  "texture",
  "textureMult",
  "texAddressModeBase",
  "timeBeforeFirstEmission",
]);
const lower = (path) => path.toLowerCase();
export function compileLatestVfxDefinition(record, manifest, samplers) {
  if (typeof samplers?.describe !== "function")
    throw Error("Native particle sampler package is required");
  if (
    manifest.build !== "16.21.829.8620" ||
    record.definition.__type !== "VfxSystemDefinitionData"
  )
    throw Error("Unsupported VFX definition package");
  const supported = [],
    omitted = [];
  for (const [index, emitter] of (
    record.definition.complexEmitterDefinitionData ?? []
  ).entries()) {
    const reasons = [],
      primitive = emitter.primitive?.__type;
    if (primitive !== "VfxPrimitiveArbitraryQuad")
      reasons.push(`primitive:${primitive ?? "implicit"}`);
    if (emitter.isSingleParticle !== 1 && emitter.isSingleParticle !== true)
      reasons.push("continuous-emission");
    for (const key of Object.keys(emitter))
      if (!coreFields.has(key)) reasons.push(`field:${key}`);
    for (const key of [
      "rate",
      "particleLifetime",
      "birthColor",
      "Color",
      "birthScale0",
      "scale0",
      "birthRotation0",
      "bindWeight",
    ])
      if (!emitter[key]) reasons.push(`unprepared-default:${key}`);
    if (![1, 4].includes(emitter.blendMode))
      reasons.push(`blend:${emitter.blendMode}`);
    if (emitter.rate?.constantValue !== 1 || emitter.rate?.dynamics)
      reasons.push("non-unit-single-particle-count");
    if (
      !(emitter.particleLifetime?.constantValue > 0) ||
      emitter.particleLifetime?.constantValue >= 29 ||
      emitter.particleLifetime?.dynamics
    )
      reasons.push("nonconstant-particle-lifetime");
    if ((emitter.timeBeforeFirstEmission ?? 0) !== 0)
      reasons.push("delayed-native-UV-birth-binding");
    if (emitter.bindWeight?.constantValue !== 1 || emitter.bindWeight?.dynamics)
      reasons.push("non-unit-binding-weight");
    const shape = emitter.SpawnShape;
    if (
      shape?.__type !== "VfxShapeLegacy" ||
      Object.keys(shape ?? {}).some(
        (k) => !["__type", "emitOffset"].includes(k),
      )
    )
      reasons.push(`spawn-shape:${shape?.__type ?? "implicit"}`);
    const walkRandom = (value, path) => {
      if (!value || typeof value !== "object") return;
      if (value.probabilityTables?.some((t) => t?.keyTimes?.length))
        reasons.push(`native-rng:${path}`);
      for (const [key, child] of Object.entries(value))
        if (key !== "probabilityTables") walkRandom(child, `${path}.${key}`);
    };
    walkRandom(emitter, "emitter");
    const texture = emitter.texture
        ? manifest.assets[lower(emitter.texture)]
        : null,
      mult = emitter.textureMult,
      multTexture = mult?.textureMult
        ? manifest.assets[lower(mult.textureMult)]
        : null;
    if (emitter.texture && !texture)
      throw Error("Prepared effect lacks its declared base texture");
    if (mult?.textureMult && !multTexture)
      throw Error("Prepared effect lacks its declared multiply texture");
    if (!texture || texture.status !== "prepared" || texture.kind !== "texture")
      reasons.push("base-texture");
    if (mult && (!multTexture || multTexture.status !== "prepared"))
      reasons.push("multiply-texture");
    const baseSampler = samplers.describe(emitter, "base"),
      multSampler = samplers.describe(emitter, "mult");
    if (!baseSampler.previewSupported)
      reasons.push(`base-sampler:${baseSampler.name}`);
    if (mult && !multSampler.previewSupported)
      reasons.push(`multiply-sampler:${multSampler.name}`);
    if (
      mult &&
      Object.keys(mult).some(
        (k) =>
          ![
            "__type",
            "textureMult",
            "UvRotationMult",
            "birthUVOffsetMult",
            "texAddressModeMult",
            "uvScaleMult",
          ].includes(k),
      )
    )
      reasons.push("multiply-texture-properties");
    if (reasons.length) {
      omitted.push({
        index,
        name: emitter.emitterName,
        reasons: [...new Set(reasons)],
      });
      continue;
    }
    supported.push({
      index,
      emitter,
      texture,
      multTexture,
      baseSampler,
      multSampler,
      life: emitter.particleLifetime.constantValue,
      delay: emitter.timeBeforeFirstEmission ?? 0,
    });
  }
  for (const [index, e] of (
    record.definition.simpleEmitterDefinitionData ?? []
  ).entries())
    omitted.push({ index, name: e.emitterName, reasons: ["simple-emitter"] });
  return {
    supported,
    omitted,
    limitations: [
      "Emitter activation at missile start and stop/linger policy are preview conventions; native birth/update/removal use supplied 60 Hz ticks plus a fractional display update",
      "Flight basis follows authored-asset evidence (local Y forward, Z up), not a recovered actor matrix",
      "Original legacy-shape birth/update and quad writer supply particle geometry, attributes, indices, packed colors and half UVs; actor orientation, seed zero and unit root inputs remain preview conventions",
      "UV matrices execute original functions on deterministic birth/age/lifetime inputs; original emitter activation and clock binding remain unresolved",
      "Two-layer unlit preview shader; native shader translation, depth sorting, bloom, fog and lighting remain unprepared",
    ],
  };
}

export function sampleLatestVfxDraws(
  playback,
  definitions,
  time,
  uvPlayback,
  lifecyclePlayback,
) {
  if (typeof uvPlayback?.sample !== "function")
    throw Error("Native UV playback is required");
  if (
    typeof lifecyclePlayback?.sample !== "function" ||
    typeof lifecyclePlayback?.beginFrame !== "function"
  )
    throw Error("Native particle lifecycle playback is required");
  lifecyclePlayback.beginFrame(time);
  const draws = [];
  for (const trace of playback.traces) {
    const definition = definitions.get(trace.effectId);
    if (!definition) throw Error("Compiled missile effect missing");
    for (const compiled of definition.supported) {
      const e = compiled.emitter,
        birth = trace.startTime;
      if (time < birth) continue;
      if (trace.stopTime !== null && birth > trace.stopTime) continue;
      // Particle tails are allowed to finish their authored life where the actor
      // requests render-after-destroy. Exact presentation-stop semantics remain open.
      if (
        trace.stopTime !== null &&
        time > trace.stopTime &&
        !trace.renderParticlesAfterDestroy
      )
        continue;
      const sample = lifecyclePlayback.sample(
        trace,
        compiled.index,
        time,
        uvPlayback,
      );
      if (sample === null) continue;
      const { quadInput, quadOutput, uvTransforms, age, life, fraction } =
          sample,
        geometry = decodeLatestVfxQuadVertices(quadOutput);
      if (geometry.vertices.length !== 4 || geometry.indices.length !== 6)
        throw Error("Unexpected single-particle quad output");
      const packedColor = geometry.vertices[0].packedColor;
      if (geometry.vertices.some((v) => v.packedColor !== packedColor))
        throw Error("Quad vertex colors require a per-vertex binding");
      draws.push({
        key: `${trace.sequence}:${compiled.index}`,
        sequence: trace.sequence,
        effectId: trace.effectId,
        entityId: trace.entityId,
        emitter: compiled.index,
        positions: geometry.vertices.map((v) => v.position),
        uv: geometry.vertices.map((v) => v.uv),
        multUv: geometry.vertices.map((v) => v.multUv),
        indices: geometry.indices,
        color: geometry.vertices[0].color,
        nativeQuad: { input: quadInput, output: quadOutput },
        texture: compiled.texture,
        multTexture: compiled.multTexture,
        baseSampler: compiled.baseSampler,
        multSampler: compiled.multSampler,
        uvTransforms,
        blend: e.blendMode,
        depthTest: !(e.miscRenderFlags & 1),
        doubleSide: !!e.disableBackfaceCull,
        pass: e.pass ?? 0,
        age,
        life,
        fraction,
      });
    }
  }
  return draws;
}
