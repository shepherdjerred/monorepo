// Original activated material passes and verified GPU resource bytes. A caller
// must still provide the render phase, variant, frame parameters and scene data.
import { sha256 } from "./structural-comparison.mjs";
export const NATIVE_PARENT_MATERIALS_SHA =
  "88485d21da5e5c2e3d5aa7b98fa5af3443335a92e0763d3d6ea12cfaf9d5dcdf";
const uint = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff,
  digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
  freeze = (v) => {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  },
  parse = (b) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b));

export function lookupNativeMaterialPass(rows, aliases, hash) {
  if (
    !uint(hash) ||
    !Array.isArray(rows) ||
    rows.length > 64 ||
    !Array.isArray(aliases) ||
    aliases.length > 64 ||
    rows.some((r) => !r || !uint(r.hash)) ||
    aliases.some((a) => !a || !uint(a.sourceHash) || !uint(a.queryHash))
  )
    throw Error(
      "Bounded native material pass rows/aliases and unsigned query required",
    );
  const visited = new Set();
  for (;;) {
    // Original 17c2100 searches direct rows first, then the first matching
    // alias's query hash. Duplicate rows/aliases retain first-match precedence.
    const selected = rows.find((r) => r.hash === hash);
    if (selected) return selected;
    if (visited.has(hash)) throw Error("Cyclic native material pass aliases");
    visited.add(hash);
    const alias = aliases.find((a) => a.queryHash === hash);
    if (!alias) return undefined;
    hash = alias.sourceHash;
  }
}

export async function createLatestNativeParentMaterials({
  profile,
  packageBytes,
  effectsManifestBytes,
}) {
  if ((await sha256(packageBytes)) !== NATIVE_PARENT_MATERIALS_SHA)
    throw Error("Native parent material package hash differs");
  const metadata = parse(packageBytes),
    manifest = parse(effectsManifestBytes);
  if (
    metadata.schema !== 1 ||
    metadata.kind !== "prepared-original-parent-materials" ||
    metadata.build !== "16.21.829.8620" ||
    metadata.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== metadata.build ||
    profile.protocolDigest !== metadata.protocol ||
    profile.decoderImageSha256 !== metadata.decoderImageSha256 ||
    metadata.effectsManifestSha256 !== (await sha256(effectsManifestBytes)) ||
    manifest.build !== metadata.build ||
    manifest.protocol !== metadata.protocol ||
    !metadata.scope.allObservedActorsAndPassesPreserved ||
    !metadata.scope.nativeGpuTextureAndConstantBytesCompared ||
    !metadata.scope.nativeGpuPipelineAndSamplerStateCompared ||
    !metadata.scope.actualFactoryParameters ||
    metadata.scope.sceneInputsProvided ||
    metadata.scope.perFrameUpdatesPrepared ||
    metadata.scope.browserExecuted
  )
    throw Error("Exact-build original parent material contract differs");
  let actors = 0,
    rows = 0,
    variants = 0;
  for (const [effectId, root] of Object.entries(metadata.roots)) {
    if (
      root.sourceDefinitionSha256 !== manifest.definitions[effectId]?.sha256 ||
      !digest(root.resourceCacheSha256) ||
      !Array.isArray(root.disabledEmitters)
    )
      throw Error("Native parent material definition/cache ownership differs");
    for (const [index, actor] of Object.entries(root.actors)) {
      if (
        !uint(actor.emitterIndex) ||
        String(actor.emitterIndex) !== index ||
        actor.emitterIndex >= root.declaredComplexEmitters ||
        root.disabledEmitters.includes(actor.emitterIndex)
      )
        throw Error("Native parent material emitter ownership differs");
      for (const [rowIndex, row] of actor.rows.entries()) {
        if (
          row.index !== rowIndex ||
          typeof row.name !== "string" ||
          !uint(row.hash) ||
          !Array.isArray(row.variants) ||
          !row.variants.length ||
          row.variants.length > 32
        )
          throw Error("Native parent material pass/variant rows differ");
        for (const [variantIndex, variant] of row.variants.entries()) {
          if (
            variant.index !== variantIndex ||
            !variant.pipeline.nativeGpuStateCompared ||
            !/^[a-f0-9]{64}$/.test(variant.pipeline.descriptorHex) ||
            !variant.scope.actualNativeMaterialFactory ||
            !variant.scope.drawTimeSceneInputsRequired
          )
            throw Error("Native parent material pipeline/variant differs");
          for (const stage of ["vertex", "pixel"]) {
            const shader = variant.shaders[stage],
              ref = metadata.shaderStages[shader.sha256];
            if (
              !ref ||
              ref.stage !== stage ||
              ref.file !== shader.file ||
              !digest(shader.sha256)
            )
              throw Error("Native parent material shader stage differs");
          }
          for (const texture of variant.textures)
            if (
              !metadata.textures[texture.texture] ||
              !/^([a-f0-9]{2}){16}$/.test(texture.sampler.descriptorHex)
            )
              throw Error("Native parent material texture/sampler differs");
          for (const constant of variant.constantBuffers)
            if (
              (await sha256(
                Uint8Array.from(constant.bytesHex.match(/../g) ?? [], (b) =>
                  parseInt(b, 16),
                ),
              )) !== constant.gpuReadbackSha256
            )
              throw Error("Native parent material constant bytes differ");
          variants++;
        }
        rows++;
      }
      // Reject malformed alias graphs before exposing immutable metadata.
      for (const hash of [
        ...actor.rows.map((r) => r.hash),
        ...actor.aliases.map((a) => a.queryHash),
      ])
        lookupNativeMaterialPass(actor.rows, actor.aliases, hash);
      actors++;
    }
  }
  if (
    Object.keys(metadata.roots).length !== metadata.counts.roots ||
    actors !== metadata.counts.actors ||
    rows !== metadata.counts.passRows ||
    variants !== metadata.counts.variants ||
    Object.keys(metadata.textures).length !== metadata.counts.textures ||
    Object.keys(metadata.shaderStages).length !== metadata.counts.shaderStages
  )
    throw Error("Native parent material inventory counts differ");
  freeze(metadata);
  return Object.freeze({
    metadata,
    passHash(name) {
      const row = metadata.registeredPasses.find((p) => p.name === name);
      if (!row) throw Error("Unknown exact native material pass name");
      return row.hash;
    },
    resolve(effectId, emitterIndex, passHash, variantIndex) {
      const actor = metadata.roots[effectId]?.actors[emitterIndex];
      if (
        !actor ||
        !uint(emitterIndex) ||
        !uint(passHash) ||
        !uint(variantIndex)
      )
        throw Error(
          "Explicit owned emitter, native pass hash and variant required",
        );
      const row = lookupNativeMaterialPass(actor.rows, actor.aliases, passHash);
      if (!row)
        return Object.freeze({
          status: "unavailable-native-material-pass",
          effectId,
          emitterIndex,
          passHash,
        });
      const variant = row.variants[variantIndex];
      if (!variant) throw Error("Unprepared native material variant");
      return Object.freeze({
        status: "prepared-native-parent-material",
        effectId,
        emitterIndex,
        passHash,
        selectedPass: row.name,
        selectedPassHash: row.hash,
        variantIndex,
        variant,
        drawTimeInputsRequired: true,
        perFrameMaterialUpdatesPrepared: false,
      });
    },
    async loadTexture(id, loadBytes) {
      const texture = metadata.textures[id];
      if (!texture || typeof loadBytes !== "function")
        throw Error(
          "Prepared native material texture and byte loader required",
        );
      const levels = [];
      for (const level of texture.levels) {
        const planes = [];
        for (const plane of level) {
          if (!/^planes\/[a-f0-9]{64}\.bin$/.test(plane.file))
            throw Error("Invalid native texture plane path");
          const bytes = await loadBytes(plane.file);
          if (
            !(bytes instanceof Uint8Array) ||
            bytes.length !== plane.bytes ||
            (await sha256(bytes)) !== plane.sha256
          )
            throw Error("Native material texture plane integrity differs");
          planes.push(bytes.slice());
        }
        levels.push(planes);
      }
      return { metadata: texture, levels };
    },
    async loadShader(id, loadBytes) {
      const ref = metadata.shaderStages[id];
      if (
        !ref ||
        typeof loadBytes !== "function" ||
        !/^stages\/[a-f0-9]{64}\.json$/.test(ref.file)
      )
        throw Error("Prepared native material shader and byte loader required");
      const bytes = await loadBytes(ref.file);
      if (
        !(bytes instanceof Uint8Array) ||
        bytes.length !== ref.bytes ||
        (await sha256(bytes)) !== ref.sha256
      )
        throw Error("Native parent material shader integrity differs");
      const translation = parse(bytes);
      if (!translation.glsl?.startsWith("#version 300 es\n"))
        throw Error("Native material shader source differs");
      return freeze(translation);
    },
  });
}
