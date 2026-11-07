import { NativeVfxSpawnKernel } from "./latest-vfx-spawn.mjs";
import { NativeQuadRuntime } from "./latest-vfx-legacy-quads.mjs";
import { emitterPreviewMath } from "./latest-vfx-emitter.mjs";
import { sha256 } from "./structural-comparison.mjs";

const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

export async function createLatestVfxLoadedQuads(
  uc,
  profile,
  image,
  spawnBytes,
  emitterBytes,
  postloadBytes,
  definitionBytes,
  graphBytes,
  math = emitterPreviewMath,
) {
  if (
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(spawnBytes)) !== profile.vfxSpawnSha256 ||
    (await sha256(emitterBytes)) !== profile.vfxEmitterSha256 ||
    (await sha256(postloadBytes)) !== profile.vfxPostloadSha256 ||
    (await sha256(definitionBytes)) !== profile.vfxLoadedQuadsSha256
  )
    throw Error("Loaded quad package integrity mismatch");
  const meta = decode(definitionBytes),
    postload = decode(postloadBytes),
    spawn = decode(spawnBytes),
    emitter = decode(emitterBytes),
    graph = decode(graphBytes),
    digest = await sha256(graphBytes),
    ref = meta.templates.find((t) => t.sha256 === digest);
  if (
    !ref ||
    meta.schema !== 1 ||
    graph.schema !== 1 ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    meta.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    meta.vfxEmitterSha256 !== profile.vfxEmitterSha256 ||
    meta.vfxPostloadSha256 !== profile.vfxPostloadSha256 ||
    meta.vfxAssetsSha256 !== profile.vfxAssetsSha256 ||
    postload.vfxAssetsSha256 !== meta.vfxAssetsSha256 ||
    postload.build !== meta.build ||
    postload.protocol !== meta.protocol ||
    postload.decoderImageSha256 !== meta.decoderImageSha256 ||
    emitter.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    emitter.decoderImageSha256 !== profile.decoderImageSha256 ||
    spawn.vfxBirthSha256 !== profile.vfxBirthSha256 ||
    spawn.vfxValuesSha256 !== profile.vfxValuesSha256 ||
    spawn.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.frameRva !== 0x1757f10 ||
    meta.writerRva !== 0x1730410 ||
    meta.primitiveVtableRva !== 0x23f20c8 ||
    meta.maximumParticles !== 1024 ||
    meta.uvScratchAddress !== 0x1002f000 ||
    JSON.stringify(meta.geometryAddresses) !==
      JSON.stringify({
        context: 0x10030000,
        view: 0x10031000,
        draw: 0x10032000,
        indices: 0x10040000,
        vertices: 0x10080000,
      }) ||
    JSON.stringify(meta.initializedGlobals) !==
      JSON.stringify(emitter.initializedGlobals) ||
    graph.build !== meta.build ||
    graph.protocol !== meta.protocol ||
    graph.effectId !== ref.effectId ||
    graph.emitterIndex !== ref.emitterIndex ||
    graph.sourceDefinitionSha256 !== ref.sourceDefinitionSha256 ||
    graph.postloadGraphSha256 !== ref.postloadGraphSha256 ||
    JSON.stringify(graph.addresses) !== JSON.stringify(spawn.addresses) ||
    ![
      "sincosf",
      "sinf",
      "cosf",
      "sqrtf",
      "acosf",
      "atan2f",
      "fmodf",
      "powf",
      "expf",
      "modff",
    ].every((n) => typeof math?.[n] === "function")
  )
    throw Error("Unsupported loaded quad runtime/graph");
  for (const template of meta.templates) {
    const source =
      postload.emitters[`${template.effectId}:${template.emitterIndex}`];
    if (
      !source ||
      source.sha256 !== template.postloadGraphSha256 ||
      source.definitionSha256 !== template.sourceDefinitionSha256
    )
      throw Error(
        "Loaded quad does not reference matching complete native asset state",
      );
  }
  const kernel = new NativeVfxSpawnKernel(
    uc,
    profile,
    image,
    spawn,
    graph,
    math,
  );
  kernel.enableEmitterMath();
  return new LoadedQuadRuntime(kernel, meta);
}

class LoadedQuadRuntime extends NativeQuadRuntime {
  renderGeometry(viewPosition, uv = null) {
    if (!this.ready || this.closed)
      throw Error("Loaded quad rendering requires initialized state");
    if (uv !== null)
      throw Error("Loaded quad UV/material binding is unimplemented");
    const k = this.kernel,
      original = k.a,
      primitive = k.q(original.definition + 0x60);
    if (k.q(primitive) !== k.base + this.metadata.primitiveVtableRva)
      throw Error("Loaded quad primitive vtable changed");
    // The shared writer uses the actual loaded primitive. The environment's
    // spare primitive and shape are unused, and no asset pointer is rewritten.
    k.a = { ...original, primitive };
    try {
      return super.renderGeometry(viewPosition);
    } finally {
      k.a = original;
    }
  }
}
