// Complete CameraTrail assets and original pool/writer instructions. Scene
// inputs are explicit; this does not infer effect activation or retirement.
import { NativeVfxSpawnKernel } from "./latest-vfx-spawn.mjs";
import { NativeQuadRuntime } from "./latest-vfx-legacy-quads.mjs";
import { emitterPreviewMath } from "./latest-vfx-emitter.mjs";
import { sha256 } from "./structural-comparison.mjs";

export const TRAIL_PARTICLES_SHA =
  "62d899efa059bea0f1c51f6091d52e927737cdad9530fcdd64856f47e4fe793f";
const decode = (b) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b));
const hex = (b) =>
  Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
const vector = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => typeof n === "number" && Number.isFinite(Math.fround(n)));
const geometry = {
  context: 0x10030000,
  view: 0x10031000,
  draw: 0x10032000,
  indices: 0x10040000,
  vertices: 0x10080000,
};

export async function createLatestTrailParticles(
  uc,
  profile,
  image,
  spawnBytes,
  emitterBytes,
  boundBytes,
  packageBytes,
  graphBytes,
  math = emitterPreviewMath,
) {
  if (
    (await sha256(packageBytes)) !== TRAIL_PARTICLES_SHA ||
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(spawnBytes)) !== profile.vfxSpawnSha256 ||
    (await sha256(emitterBytes)) !== profile.vfxEmitterSha256 ||
    (await sha256(boundBytes)) !== profile.vfxBoundQuadsSha256
  )
    throw Error("Trail package integrity mismatch");
  const meta = decode(packageBytes),
    spawn = decode(spawnBytes),
    emitter = decode(emitterBytes),
    bound = decode(boundBytes),
    graph = decode(graphBytes),
    digest = await sha256(graphBytes),
    ref = meta.templates.find((t) => t.sha256 === digest);
  if (
    !ref ||
    meta.schema !== 1 ||
    meta.kind !== "complete-native-camera-trails" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    profile.decoderImageSha256 !== meta.decoderImageSha256 ||
    meta.decoderImageSha256 !==
      "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7" ||
    profile.sliceSha256 !== meta.sliceSha256 ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    spawn.runtimeSha256 !== meta.runtimeSha256 ||
    meta.vfxBoundQuadsSha256 !== profile.vfxBoundQuadsSha256 ||
    meta.vfxPostloadSha256 !== profile.vfxPostloadSha256 ||
    meta.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    meta.vfxEmitterSha256 !== profile.vfxEmitterSha256 ||
    emitter.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    meta.frameRva !== 0x1757f10 ||
    meta.writerRva !== 0x1737570 ||
    meta.primitiveVtableRva !== 0x23f6520 ||
    meta.maximumParticles !== 1024 ||
    meta.texturePresenceMarker !== 0x20000000 ||
    meta.counts.sourceEmitters !== 4921 ||
    meta.counts.preparedEmitters !== 146 ||
    meta.templates.length !== 146 ||
    JSON.stringify(meta.initializedGlobals) !==
      JSON.stringify(bound.initializedGlobals) ||
    graph.schema !== 1 ||
    graph.build !== meta.build ||
    graph.protocol !== meta.protocol ||
    graph.effectId !== ref.effectId ||
    graph.emitterIndex !== ref.emitterIndex ||
    graph.primitiveKind !== "camera-trail" ||
    graph.sourceDefinitionSha256 !== ref.sourceDefinitionSha256 ||
    graph.postloadGraphSha256 !== ref.postloadGraphSha256 ||
    JSON.stringify(graph.addresses) !== JSON.stringify(spawn.addresses) ||
    JSON.stringify(graph.uvFlags) !== JSON.stringify(ref.uvFlags) ||
    graph.hasMultDefinition !== ref.hasMultDefinition ||
    !meta.scope.completePostloadedAsset ||
    !meta.scope.assetBytesUnchanged ||
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
    ].every((name) => typeof math?.[name] === "function")
  )
    throw Error("Unsupported CameraTrail runtime/asset");
  const data = image instanceof Uint8Array ? image : new Uint8Array(image);
  for (const b of meta.sourceBlocks)
    if ((await sha256(data.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("Original CameraTrail instructions changed");
  const kernel = new NativeVfxSpawnKernel(
    uc,
    profile,
    data,
    spawn,
    graph,
    math,
  );
  kernel.engine.mem_unmap(meta.texturePresenceMarker, 0x1000);
  kernel.enableEmitterMath();
  return new TrailParticleRuntime(kernel, meta);
}

function cameraInput(camera) {
  const axis = camera?.axis;
  if (
    !vector(axis) ||
    Math.abs(axis.reduce((s, n) => s + n * n, 0) - 1) > 0.00002 ||
    typeof camera.multTexturePresent !== "boolean"
  )
    throw Error(
      "Explicit unit trail view axis and mult-texture presence required",
    );
  return axis;
}

class TrailParticleRuntime extends NativeQuadRuntime {
  readParticleCount() {
    if (!this.ready || this.closed)
      throw Error("Trail count requires initialized state");
    const k = this.kernel,
      count = k.readU32(k.q(k.a.actor + 0xa0) + 0x10);
    if (count > 1024) throw Error("Trail particle limit");
    return count;
  }
  advance(input) {
    cameraInput({
      axis: input.viewAxis,
      multTexturePresent: input.multTexturePresent,
    });
    this.kernel.u64(
      this.kernel.a.link + 0x58,
      input.multTexturePresent ? this.metadata.texturePresenceMarker : 0,
    );
    super.advance(input);
  }
  frame(input) {
    this.advance(input);
    return {
      state: this.readState(),
      geometry: this.renderGeometry(input.viewPosition, {
        axis: input.viewAxis,
        multTexturePresent: input.multTexturePresent,
      }),
    };
  }
  renderGeometry(viewPosition, camera) {
    if (!this.ready || this.closed || !vector(viewPosition))
      throw Error(
        "Trail geometry requires initialized state and finite view position",
      );
    const axis = cameraInput(camera),
      k = this.kernel,
      a = k.a,
      g = geometry,
      count = k.readU32(k.q(a.actor + 0xa0) + 0x10);
    if (count > 1024) throw Error("Trail particle limit");
    k.u64(
      a.link + 0x58,
      camera.multTexturePresent ? this.metadata.texturePresenceMarker : 0,
    );
    k.engine.mem_write(g.context, new Uint8Array(0x3000));
    for (const [offset, pointer] of [
      [0, g.indices],
      [8, g.vertices],
      [0x10, g.draw],
      [0x18, a.actor],
      [0x20, g.view],
    ])
      k.u64(g.context + offset, pointer);
    k.put(g.view, viewPosition);
    k.put(g.view + 0x24, axis);
    const primitive = k.q(a.definition + 0x60);
    if (k.q(primitive) !== k.base + this.metadata.primitiveVtableRva)
      throw Error("Loaded CameraTrail primitive changed");
    k.mathCalls = [];
    k.callNative(this.metadata.writerRva, { RDI: primitive, RSI: g.context });
    const nv = k.q(g.context + 8) - g.vertices,
      ni = k.q(g.context) - g.indices;
    if (
      nv < 0 ||
      nv > count * 56 ||
      ni < 0 ||
      ni > Math.max(0, count - 1) * 12 ||
      nv % 28 ||
      ni % 2
    )
      throw Error("Trail geometry exceeds owned buffers");
    return {
      verticesHex: hex(k.read(g.vertices, nv)),
      indicesHex: hex(k.read(g.indices, ni)),
      drawHex: hex(k.read(g.draw, 16)),
      mathCalls: [...k.mathCalls],
    };
  }
}
