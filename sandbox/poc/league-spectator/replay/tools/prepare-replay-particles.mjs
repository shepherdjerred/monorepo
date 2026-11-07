// Build-specific GPU bindings for the currently admitted replay emitters.
// Native decisions are copied from inspected material observations. Unrecovered
// scene inputs and neutral diagnostic lookups remain explicit package inputs.
import { resolve } from "node:path";
import { createLatestVfxMaterials } from "../latest-vfx-materials.mjs";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: prepare-replay-particles.mjs <cache>");
const cache = resolve(cacheArg),
  publicRoot = `${cache}/public`,
  decoder = `${publicRoot}/decoder-16.21-macos`;
const sha = (value) =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");
const sources = {};
const bytes = async (path) => {
  const value = new Uint8Array(await Bun.file(path).arrayBuffer());
  sources[path] = sha(value);
  return value;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await bytes(path)));
const profile = await read(`${decoder}/profile.json`),
  bound = await read(`${decoder}/vfx-bound-quads.json`),
  legacy = await read(`${decoder}/vfx-legacy-quads.json`);
const shaderPackage = await read(`${publicRoot}/latest-shaders/package.json`),
  pairs = await read(`${cache}/research/latest-shaders/pairs.json`);
const effectManifest = await read(`${publicRoot}/latest-effects/manifest.json`),
  materialRaw = await bytes(`${cache}/research/vfx-materials-native.json`);
const materialProof = await read(
  `${cache}/research/vfx-materials-comparison.json`,
);
if (
  sha(materialRaw) !== materialProof.materialPackageSha256 ||
  materialProof.scope.mismatchCount !== 0 ||
  sources[`${publicRoot}/latest-shaders/package.json`] !==
    materialProof.shaderPackageSha256 ||
  pairs.shaderPackageSha256 !== materialProof.shaderPackageSha256 ||
  sources[`${decoder}/vfx-bound-quads.json`] !== profile.vfxBoundQuadsSha256 ||
  sources[`${decoder}/vfx-legacy-quads.json`] !==
    profile.vfxLegacyQuadsSha256 ||
  sources[`${publicRoot}/latest-effects/manifest.json`] !==
    legacy.effectsManifestSha256 ||
  materialProof.moduleSha256 !==
    sha(await bytes(resolve(import.meta.dir, "../latest-vfx-materials.mjs")))
)
  throw Error("Unmatched native material, shader or emitter preparation");
const materialApi = await createLatestVfxMaterials(
    materialRaw,
    sha(materialRaw),
    profile,
  ),
  emitters = [],
  shaderRefs = new Map();
for (const admitted of legacy.templates) {
  const ref = bound.templates.find(
    (entry) =>
      entry.effectId === admitted.effectId &&
      entry.emitterIndex === admitted.emitterIndex,
  );
  if (!ref || ref.sourceDefinitionSha256 !== admitted.sourceDefinitionSha256)
    throw Error("No complete counterpart for admitted emitter");
  const definition = effectManifest.definitions[ref.effectId],
    record = await read(`${publicRoot}/latest-effects/${definition.file}`);
  if (
    sources[`${publicRoot}/latest-effects/${definition.file}`] !==
    ref.sourceDefinitionSha256
  )
    throw Error("Emitter source definition changed");
  const emitter =
    record.definition.complexEmitterDefinitionData[ref.emitterIndex];
  if (
    emitter.alphaErosionDefinition ||
    emitter.paletteDefinition ||
    emitter.reflectionDefinition ||
    emitter.particleColorTexture
  )
    throw Error("Replay GPU package requires additional runtime resources");
  const environment = {
    pass: 0,
    featuresEnabled: true,
    resourceMask: ref.hasMultDefinition ? 1 : 0,
    systemFogMode: 1,
    graphics34b: false,
    graphics29c: 0,
  };
  const native = materialApi.describe(
    ref.effectId,
    ref.emitterIndex,
    environment,
    { erosionDrive: null },
  );
  if (native.graphSha256 !== ref.sha256)
    throw Error("Material/geometry complete graph mismatch");
  const family = shaderPackage.pairs.find(
    (pair) =>
      pair.vertex === native.vertex.toLowerCase() &&
      pair.pixel === native.pixel.toLowerCase(),
  );
  if (!family) throw Error("Unprepared native replay shader family");
  const declared = new Map(
    pairs.groups
      .find((group) => group.name === family.name)
      .declares.map((d) => [d.name, d.value]),
  );
  const defines = native.defines
    .filter((d) => declared.get(d.name) === d.value)
    .sort((a, b) => a.name.localeCompare(b.name));
  const candidates = pairs.programs.filter(
    (pair) =>
      pair.family === family.name &&
      JSON.stringify(pair.defines) === JSON.stringify(defines),
  );
  if (candidates.length !== 1)
    throw Error("Ambiguous/unprepared native replay shader permutation");
  const pair = candidates[0],
    stages = [];
  for (const stage of ["vertex", "pixel"]) {
    const shader = await read(
      `${publicRoot}/latest-shaders/${pair[stage].file}`,
    );
    if (
      sources[`${publicRoot}/latest-shaders/${pair[stage].file}`] !==
        pair[stage].sha256 ||
      shader.adapter?.samplerNames !== "original DXBC RDEF"
    )
      throw Error("Replay shader input/adapter changed");
    shaderRefs.set(pair[stage].sha256, pair[stage]);
    stages.push(shader);
  }
  const blocks = [],
    textures = {};
  for (const stage of stages) {
    for (const block of stage.sidecar.blocks) {
      const data = new Uint8Array(block.size),
        sceneMembers = [];
      for (const member of block.members) {
        if (!member.used) continue;
        if (native.parameters.has(member.name)) {
          const value = native.parameters.get(member.name);
          if (member.scalar !== "float" || member.size > value.byteLength)
            throw Error("Native replay material vector width/type mismatch");
          data.set(
            new Uint8Array(value.buffer, value.byteOffset, member.size),
            member.offset,
          );
        } else if (
          (member.name === "mProj" &&
            member.scalar === "float" &&
            member.size === 64 &&
            !member.rowMajor &&
            member.rows === 4 &&
            member.columns === 4) ||
          (member.name === "vCamera" &&
            member.scalar === "float" &&
            member.size === 12)
        ) {
          sceneMembers.push({
            name: member.name,
            offset: member.offset,
            size: member.size,
          });
        } else if (
          [
            "RENDERTARGET_IS_SRGB",
            "DEBUG_RENDERTARGET_IS_SRGB_HANDLED",
          ].includes(member.name) &&
          ["uint", "bool"].includes(member.scalar) &&
          member.size === 4
        ) {
          // Explicit diagnostic target convention, not recovered game globals.
          new DataView(data.buffer).setUint32(member.offset, 0, true);
        } else
          throw Error(
            `Unprovided replay shader uniform: ${block.glslName}.${member.name}`,
          );
      }
      blocks.push({
        glslName: block.glslName,
        size: block.size,
        bytesHex: Buffer.from(data).toString("hex"),
        sceneMembers,
      });
    }
    for (const texture of stage.sidecar.textures) {
      let binding;
      if (["TEXTURE__TX", "TEXTUREMULT__TX"].includes(texture.name)) {
        const layer = texture.name === "TEXTURE__TX" ? "base" : "mult";
        const path =
          layer === "base" ? emitter.texture : emitter.textureMult?.textureMult;
        const asset = effectManifest.assets[path?.toLowerCase()];
        const sampler = native.samplers.find((s) => s.layer === layer);
        if (
          !asset ||
          asset.status !== "prepared" ||
          asset.kind !== "texture" ||
          !sampler
        )
          throw Error("Missing native replay texture/sampler");
        const descriptor = [...Buffer.from(sampler.descriptorHex, "hex")];
        if (
          descriptor.length !== 5 ||
          descriptor.slice(0, 3).some((v) => v !== descriptor[0]) ||
          descriptor[3] !== descriptor[4] ||
          descriptor[0] > 2 ||
          descriptor[3] > 1
        )
          throw Error("Unimplemented replay sampler descriptor");
        if (
          sha(await bytes(`${publicRoot}/latest-effects/${asset.file}`)) !==
          asset.sha256
        )
          throw Error("Replay texture changed");
        binding = {
          kind: "prepared-texture",
          file: asset.file,
          sha256: asset.sha256,
          sampler: {
            name: ["repeat", "clamp", "mirror"][descriptor[0]],
            pixelated: !descriptor[3],
          },
          nativeSamplerHex: sampler.descriptorHex,
        };
      } else if (texture.name === "PARTICLE_COLOR_TEXTURE__TX")
        binding = { kind: "supplied-white-lookup" };
      else if (texture.name === "PIXEL_COLOR_REMAP_RAMP_SharedTexture")
        binding = { kind: "supplied-transparent-remap" };
      else throw Error(`Unprovided replay texture: ${texture.name}`);
      for (const sampler of texture.samplers) {
        if (!sampler.sampler || Object.hasOwn(textures, sampler.glslName))
          throw Error("Ambiguous replay shader sampler binding");
        textures[sampler.glslName] = binding;
      }
    }
  }
  const state = [...Buffer.from(native.renderStateHex, "hex")],
    factors = state.slice(10, 14);
  if (
    ![1, 6, 7].includes(factors[0]) ||
    factors[1] !== factors[0] ||
    ![1, 6, 7].includes(factors[2]) ||
    factors[3] !== factors[2]
  )
    throw Error("Unimplemented native replay blend factors");
  emitters.push({
    effectId: ref.effectId,
    emitterIndex: ref.emitterIndex,
    graphSha256: ref.sha256,
    sourceDefinitionSha256: ref.sourceDefinitionSha256,
    environment,
    family: family.name,
    defines,
    shaders: Object.fromEntries(
      ["vertex", "pixel"].map((stage) => [stage, pair[stage]]),
    ),
    blocks,
    textures,
    nativeRenderStateHex: native.renderStateHex,
    nativeBlendFactors: factors,
    suppliedDepthTest: !(emitter.miscRenderFlags & 1),
    suppliedDoubleSide: !!emitter.disableBackfaceCull,
    suppliedSortPass: emitter.pass ?? 0,
  });
}
const result = {
  schema: 1,
  kind: "prepared-replay-particle-gpu-bindings",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  quadPackageSha256: profile.vfxBoundQuadsSha256,
  effectsManifestSha256: legacy.effectsManifestSha256,
  nativeMaterialPackageSha256: sha(materialRaw),
  shaderPackageSha256: materialProof.shaderPackageSha256,
  preparerSha256: sha(await bytes(import.meta.path)),
  sources,
  emitters,
  counts: { emitters: emitters.length, shaderStages: shaderRefs.size },
  scope: {
    suppliedFogMode: 1,
    suppliedLinearTarget: true,
    suppliedWhiteParticleColorLookup: true,
    suppliedTransparentRemap: true,
    completeNativeGraphIdentity: true,
    nativeBlendFactors: true,
    resourceAcquisition: false,
    fullDepthCullStateRecovered: false,
    originalPassScheduling: false,
    postprocess: false,
    browserRun: false,
    leagueReferenceCompared: false,
  },
};
const output = JSON.stringify(result, null, 2);
await Bun.write(`${publicRoot}/latest-replay-particles/package.json`, output);
console.log(JSON.stringify({ sha256: sha(output), counts: result.counts }));
