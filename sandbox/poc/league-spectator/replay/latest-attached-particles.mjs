// Native particle-pool execution for complete attached-mesh emitters. This
// component has no mesh writer and does not infer an owner, seed or frame clock.
import { NativeVfxSpawnKernel } from "./latest-vfx-spawn.mjs";
import { NativeQuadRuntime } from "./latest-vfx-legacy-quads.mjs";
import { emitterPreviewMath } from "./latest-vfx-emitter.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { ATTACHED_MESH_SHA } from "./latest-attached-mesh.mjs";
export const ATTACHED_PARTICLES_SHA =
  "8c4844c435d3223bc5111ecc1874b8b311aafed34e358d669bb0d08d941812a7";
const parse = (b) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b));
export async function createLatestAttachedParticles(
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
    (await sha256(packageBytes)) !== ATTACHED_PARTICLES_SHA ||
    (await sha256(image)) !== profile.decoderImageSha256 ||
    (await sha256(spawnBytes)) !== profile.vfxSpawnSha256 ||
    (await sha256(emitterBytes)) !== profile.vfxEmitterSha256 ||
    (await sha256(boundBytes)) !== profile.vfxBoundQuadsSha256
  )
    throw Error("Attached particle package integrity mismatch");
  const meta = parse(packageBytes),
    spawn = parse(spawnBytes),
    emitter = parse(emitterBytes),
    bound = parse(boundBytes),
    graph = parse(graphBytes),
    digest = await sha256(graphBytes),
    ref = meta.templates.find((t) => t.sha256 === digest);
  if (
    !ref ||
    meta.schema !== 1 ||
    meta.kind !== "native-attached-particle-pools" ||
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
    meta.attachedMeshPackageSha256 !== ATTACHED_MESH_SHA ||
    meta.vfxBoundQuadsSha256 !== profile.vfxBoundQuadsSha256 ||
    meta.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    meta.vfxEmitterSha256 !== profile.vfxEmitterSha256 ||
    meta.vfxPostloadSha256 !== profile.vfxPostloadSha256 ||
    emitter.vfxSpawnSha256 !== profile.vfxSpawnSha256 ||
    spawn.vfxBirthSha256 !== profile.vfxBirthSha256 ||
    spawn.vfxValuesSha256 !== profile.vfxValuesSha256 ||
    spawn.decoderImageSha256 !== meta.decoderImageSha256 ||
    emitter.decoderImageSha256 !== meta.decoderImageSha256 ||
    meta.frameRva !== 0x1757f10 ||
    meta.constructorPrefix.join(",") !== [0x1756780, 0x1756a26].join(",") ||
    meta.primitiveType !== 11 ||
    meta.primitiveVtableRva !== 0x23f6d30 ||
    meta.maximumParticles !== 1024 ||
    meta.drawAttributeStride !== 0x2c ||
    meta.colorInputOffset !== 4 ||
    meta.erosionInputOffset !== 0x28 ||
    meta.rootColorOffset !== 0xe0 ||
    meta.rootBlendOffset !== 0x14 ||
    meta.counts.sourceEmitters !== 181 ||
    meta.counts.preparedEmitters !== 179 ||
    meta.counts.rejectedEmitters !== 2 ||
    meta.templates.length !== 179 ||
    meta.rejected.length !== 2 ||
    JSON.stringify(meta.initializedGlobals) !==
      JSON.stringify(bound.initializedGlobals) ||
    meta.scope.completePostloadedAsset !== true ||
    meta.scope.assetBytesUnchanged !== true ||
    meta.scope.absentOwnerNativeIdentityFallback !== true ||
    meta.scope.ownerPoseBindingExecuted !== false ||
    meta.scope.meshGeometrySubmitted !== false ||
    meta.scope.fullEffectLifecycleReconstructed !== false ||
    graph.schema !== 1 ||
    graph.build !== meta.build ||
    graph.protocol !== meta.protocol ||
    graph.primitiveKind !== "attached" ||
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
    throw Error("Unsupported attached particle runtime/graph");
  const data = image instanceof Uint8Array ? image : new Uint8Array(image);
  for (const b of meta.sourceBlocks)
    if ((await sha256(data.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("Original attached pool instructions changed");
  const kernel = new NativeVfxSpawnKernel(
    uc,
    profile,
    image,
    spawn,
    graph,
    math,
  );
  kernel.enableEmitterMath();
  return new AttachedParticleRuntime(kernel, meta);
}
class AttachedParticleRuntime extends NativeQuadRuntime {
  frame(input) {
    this.advance(input);
    return this.readState();
  }
  renderGeometry() {
    throw Error("Attached particle component has no mesh writer");
  }
  drawValues() {
    if (!this.ready || this.closed)
      throw Error("Attached draw values require initialized state");
    const k = this.kernel,
      pool = k.q(k.a.actor + 0xa0),
      count = k.readU32(pool + 0x10),
      attributes = k.q(pool + 0x98),
      bytes = k.read(k.a.definition + 0xe0, 16),
      root = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      blend = k.read(k.a.definition + 0x14, 1)[0],
      out = [];
    if (count > 1024 || k.readU32(pool + 0xa0) !== count)
      throw Error("Attached draw attributes differ from live pool");
    const encode = (values) => {
      const b = new Uint8Array(values.length * 4),
        v = new DataView(b.buffer);
      values.forEach((x, i) => v.setFloat32(i * 4, x, true));
      return Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
    };
    for (let i = 0; i < count; i++) {
      const b = k.read(attributes + i * 0x2c, 0x2c),
        v = new DataView(b.buffer, b.byteOffset, b.byteLength),
        color = Array.from({ length: 4 }, (_, j) =>
          Math.fround(
            v.getFloat32(4 + j * 4, true) * root.getFloat32(j * 4, true),
          ),
        );
      if ((blend & 0xfd) === 0) {
        for (let j = 0; j < 3; j++) color[j] = Math.fround(color[j] * color[3]);
        color[3] = 1;
      }
      const erosion = v.getFloat32(0x28, true);
      if (!color.every(Number.isFinite) || !Number.isFinite(erosion))
        throw Error("Non-finite attached particle draw value");
      out.push({
        colorFactor: { bytesHex: encode(color), value: color },
        erosionDriveHex: encode([erosion]),
        erosionDrive: erosion,
      });
    }
    return out;
  }
}
