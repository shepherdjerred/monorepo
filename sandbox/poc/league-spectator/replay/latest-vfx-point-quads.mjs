import { NativeVfxSpawnKernel } from "./latest-vfx-spawn.mjs";
import { NativeQuadRuntime } from "./latest-vfx-legacy-quads.mjs";
import { emitterPreviewMath } from "./latest-vfx-emitter.mjs";
import { sha256 } from "./structural-comparison.mjs";

export async function createLatestVfxPointQuads(
  uc,
  profile,
  image,
  spawnBytes,
  emitterBytes,
  definitionBytes,
  graphBytes,
  math = emitterPreviewMath,
) {
  if (
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(spawnBytes)) !== profile.vfxSpawnSha256 ||
    (await sha256(emitterBytes)) !== profile.vfxEmitterSha256 ||
    (await sha256(definitionBytes)) !== profile.vfxPointQuadsSha256
  )
    throw Error("Point-quad package integrity mismatch");
  const decode = (b) => JSON.parse(new TextDecoder().decode(b)),
    meta = decode(definitionBytes),
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
    meta.vfxQuadVerticesSha256 !== profile.vfxQuadVerticesSha256 ||
    emitter.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    spawn.vfxBirthSha256 !== profile.vfxBirthSha256 ||
    spawn.vfxValuesSha256 !== profile.vfxValuesSha256 ||
    spawn.decoderImageSha256 !== profile.decoderImageSha256 ||
    emitter.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.frameRva !== 0x1757f10 ||
    meta.writerRva !== 0x1730410 ||
    meta.maximumParticles !== 1024 ||
    meta.uvScratchAddress !== 0x1002f000 ||
    JSON.stringify(meta.shapeConstructorBlock) !==
      JSON.stringify([0x179556e, 0x179558c]) ||
    meta.primitiveConstructorRva !== 0x17a6390 ||
    JSON.stringify(meta.geometryAddresses) !==
      JSON.stringify({
        context: 0x10030000,
        view: 0x10031000,
        draw: 0x10032000,
        indices: 0x10040000,
        vertices: 0x10080000,
      }) ||
    JSON.stringify(meta.checkpointLayout) !==
      JSON.stringify({
        ownedAddress: 0x10020000,
        ownedBytes: 0x10000,
        heapAddress: 0x10400000,
        heapLimit: 0x12000000,
        globals: [{ rva: 0x2516698, bytes: 8 }],
      }) ||
    graph.shapeType !== "{ee39916f}" ||
    graph.build !== meta.build ||
    graph.protocol !== meta.protocol ||
    graph.effectId !== ref.effectId ||
    graph.emitterIndex !== ref.emitterIndex ||
    graph.sourceDefinitionSha256 !== ref.sourceDefinitionSha256 ||
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
    throw Error("Unsupported point-quad runtime/graph");
  const imageBytes =
    image instanceof Uint8Array ? image : new Uint8Array(image);
  for (const block of meta.executedOriginalPreparationBlocks)
    if (
      (await sha256(imageBytes.subarray(block.rva, block.rva + block.size))) !==
      block.sha256
    )
      throw Error("Point-quad preparation code changed");
  const kernel = new NativeVfxSpawnKernel(
    uc,
    profile,
    image,
    spawn,
    graph,
    math,
  );
  kernel.enableEmitterMath();
  return new NativeQuadRuntime(kernel, meta);
}
