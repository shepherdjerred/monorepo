import { NativeVfxSpawnKernel, spawnPreviewMath } from "./latest-vfx-spawn.mjs";
import { sha256 } from "./structural-comparison.mjs";

export const NATIVE_ANIMATION_PACKAGE_SHA =
  "254a073494f5bf3380caaff1cf743ca039d29b72d351af758ccf38b93b2e7b46";
const runtimeSha =
  "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716";
const functions = {
  compressed: 0x15b0b30,
  uncompressed: 0x15b53e0,
  world: 0x15852a0,
  skin: 0x1586f40,
  cacheInitializationBlock: [0x15889f8, 0x1588a19],
  sentinelInitializationBlock: [0x15dcd0e, 0x15dcd18],
};
const bytes = (value) =>
  value instanceof Uint8Array ? value : new Uint8Array(value);

class NativeAnimationKernel extends NativeVfxSpawnKernel {
  service(at) {
    if (at !== 0x1fee5fa) return super.service(at);
    const dest = Number(this.engine.reg_read_i64(this.uc.X86_REG_RDI)),
      size = Number(this.engine.reg_read_i64(this.uc.X86_REG_RSI));
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > 0x100000 ||
      ![...this.allocations].some(
        ([base, length]) => dest >= base && dest + size <= base + length,
      )
    )
      throw Error("Native ANM bzero exceeds a current owned allocation");
    this.services.bzero = (this.services.bzero ?? 0) + 1;
    this.engine.mem_write(dest, new Uint8Array(size));
    this.ret();
  }
}

// An isolated exact-build asset set. Each clip sampler retains its own native
// compressed cache. Output buffers are supplied by the caller and can be reused.
// Native arena storage is retained until close(); this is not a graph blender.
export async function createLatestNativeAnimationResources({
  uc,
  profile,
  image,
  spawnBytes,
  manifestBytes,
  binaryBytes,
}) {
  const imageRaw = bytes(image),
    spawnRaw = bytes(spawnBytes),
    manifestRaw = bytes(manifestBytes),
    binary = bytes(binaryBytes);
  if (
    (await sha256(imageRaw)) !== profile.decoderImageSha256 ||
    (await sha256(spawnRaw)) !== profile.vfxSpawnSha256 ||
    (await sha256(manifestRaw)) !== NATIVE_ANIMATION_PACKAGE_SHA
  )
    throw Error("Pinned original animation package/image required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(manifestRaw),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "prepared-native-animation-resources" ||
    meta.build !== "16.21.829.8620" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.protocol !== "20e09df23c66b85e" ||
    meta.runtimeSha256 !== runtimeSha ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    (await sha256(binary)) !== meta.binarySha256 ||
    JSON.stringify(meta.functions) !== JSON.stringify(functions) ||
    !meta.scope.staticAssetInputsOnly ||
    meta.scope.sampledAnimationFramesIncluded ||
    meta.scope.replayEventsIncluded ||
    !meta.scope.nativeConstructedBindPoseTemplate ||
    !meta.scope.isolatedAssetSetRequired
  )
    throw Error("Unsupported native animation package contract");
  const zero = profile.modeledServices.find((p) => p.rva === 0x1fee5fa);
  if (
    zero?.service !== "___bzero" ||
    zero.bytesHex !== "e9ac8b620090" ||
    (await sha256(imageRaw.subarray(0x1fee5fa, 0x1fee600))) !==
      (await sha256(Uint8Array.from([0xe9, 0xac, 0x8b, 0x62, 0, 0x90])))
  )
    throw Error("Exact native animation bzero binding required");
  const count = meta.rig.jointCount;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 256 ||
    meta.rig.joints.length !== count ||
    !Array.isArray(meta.resources) ||
    !meta.resources.length ||
    meta.resources.length > 256
  )
    throw Error("Bounded native animation rig/resources required");
  const segments = [],
    ranges = [];
  let heap = 0x10400000,
    offset = 0;
  for (const s of meta.segments) {
    if (
      !Number.isSafeInteger(s.address) ||
      !Number.isSafeInteger(s.size) ||
      s.size <= 0 ||
      s.address < 0x10400000 ||
      s.address + s.size > 0x12000000 ||
      s.offset !== offset ||
      ranges.some(([a, b]) => s.address < b && a < s.address + s.size)
    )
      throw Error("Static animation segments overlap or exceed bounds");
    const raw = binary.subarray(s.offset, s.offset + s.size);
    if (raw.length !== s.size || (await sha256(raw)) !== s.sha256)
      throw Error("Static animation segment changed");
    segments.push({ ...s, raw });
    ranges.push([s.address, s.address + s.size]);
    heap = Math.max(heap, s.address + s.size);
    offset += s.size;
  }
  if (offset !== binary.length)
    throw Error("Trailing native animation package bytes");
  const template = segments.filter((s) =>
    meta.poseTemplate.segments.includes(s.address),
  );
  if (
    template.length !== meta.poseTemplate.segments.length ||
    !template.some((s) => s.address === meta.poseTemplate.address)
  )
    throw Error("Complete original bind-pose template required");
  const resources = new Map();
  for (const resource of meta.resources) {
    if (
      !/^[a-f0-9]{16}$/.test(resource.keyHex) ||
      resources.has(resource.keyHex) ||
      !["compressed", "uncompressed"].includes(resource.kind) ||
      resource.evaluatorRva !== functions[resource.kind] ||
      !Number.isInteger(resource.frames) ||
      resource.frames < 1 ||
      resource.frames > 100000 ||
      !Number.isFinite(resource.fps) ||
      resource.fps <= 0 ||
      resource.fps > 10000 ||
      !Array.isArray(resource.trackIndices) ||
      !/^[a-f0-9]{64}$/.test(resource.sourceSha256) ||
      resource.trackIndices.length !== count ||
      resource.trackIndices.some(
        (i) => !Number.isInteger(i) || i < -1 || i > 65535,
      ) ||
      !segments.some(
        (s) =>
          s.address === resource.address && s.size >= 0x38 && s.size <= 0x70,
      )
    )
      throw Error("Unsupported original ANM resource");
    resources.set(resource.keyHex, resource);
  }
  const spawn = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(spawnRaw),
  );
  const k = new NativeAnimationKernel(
    uc,
    profile,
    imageRaw,
    { ...spawn, services: [...spawn.services, 0x1fee5fa] },
    null,
    spawnPreviewMath,
  );
  const e = k.engine,
    pose = meta.poseTemplate.address,
    root = 0x10090000,
    canary = 0x10091000,
    skinOutput = 0x10080000;
  const skinBlank = new Uint8Array(count * 48 + 0x100).fill(0xa5);
  let closed = false,
    poisoned = false,
    running = false;
  const bindings = new Set();
  const ensure = () => {
    if (closed || poisoned) throw Error("Unavailable native animation runtime");
  };
  const u32 = (at, value) => {
    const raw = new Uint8Array(4);
    new DataView(raw.buffer).setUint32(0, value, true);
    e.mem_write(at, raw);
  };
  const resetPose = () => {
    for (const s of template) e.mem_write(s.address, s.raw);
  };
  const checkOutput = (output) => {
    const fields = [
        ["local", count * 10],
        ["world", count * 10],
        ["skinMatrices", count * 12],
      ],
      views = [];
    for (const [name, length] of fields) {
      const view = output?.[name];
      if (!(view instanceof Float32Array) || view.length !== length)
        throw Error("Exact native animation output buffers required");
      if (
        views.some(
          (v) =>
            v.buffer === view.buffer &&
            v.byteOffset < view.byteOffset + view.byteLength &&
            view.byteOffset < v.byteOffset + v.byteLength,
        )
      )
        throw Error("Native animation outputs must not overlap");
      views.push(view);
    }
  };
  try {
    for (const s of segments) e.mem_write(s.address, s.raw);
    k.nextHeap = Math.ceil(heap / 16) * 16;
    k.allocations = new Map();
    k.services = {};
    k.births = [];
    k.mathCalls = [];
    k.u64(k.base + 0x22e0310, canary);
    k.u64(canary, 0x7766554433221100n);
    for (const end of [
      functions.cacheInitializationBlock[1],
      functions.sentinelInitializationBlock[1],
    ])
      e.hook_add(
        uc.HOOK_CODE,
        () => e.emu_stop(),
        null,
        k.base + end,
        k.base + end,
      );
    k.callNative(
      functions.sentinelInitializationBlock[0],
      {},
      functions.sentinelInitializationBlock[1],
    );
    if (k.q(pose + 0x70) !== meta.rig.address)
      throw Error("Original pose template rig differs");
  } catch (error) {
    e.close();
    throw error;
  }
  return Object.freeze({
    actor: meta.actor,
    build: meta.build,
    protocol: meta.protocol,
    jointNames: Object.freeze([...meta.rig.joints]),
    resources: Object.freeze(
      [...resources.values()].map((r) =>
        Object.freeze({
          keyHex: r.keyHex,
          sourceSha256: r.sourceSha256,
          kind: r.kind,
          frames: r.frames,
          fps: r.fps,
        }),
      ),
    ),
    createOutput() {
      ensure();
      return {
        local: new Float32Array(count * 10),
        world: new Float32Array(count * 10),
        skinMatrices: new Float32Array(count * 12),
      };
    },
    createClipSampler(keyHex) {
      ensure();
      if (running) throw Error("Reentrant native animation binding");
      const resource = resources.get(keyHex);
      if (!resource) throw Error("Unadmitted native animation resource key");
      const mapping = k.allocate(16),
        indices = k.allocate(count * 4),
        cacheOwner = resource.kind === "compressed" ? k.allocate(0x170) : 0;
      k.u64(mapping, indices);
      u32(mapping + 8, count);
      u32(mapping + 12, count);
      const indexBytes = new Uint8Array(count * 4),
        view = new DataView(indexBytes.buffer);
      resource.trackIndices.forEach((value, i) =>
        view.setInt32(i * 4, value, true),
      );
      e.mem_write(indices, indexBytes);
      if (cacheOwner)
        try {
          k.callNative(
            functions.cacheInitializationBlock[0],
            { RDI: cacheOwner },
            functions.cacheInitializationBlock[1],
          );
        } catch (error) {
          poisoned = true;
          throw error;
        }
      const state = { disposed: false };
      bindings.add(state);
      return {
        sampleInto({ time, rootPose, inheritScale }, output) {
          ensure();
          if (state.disposed || running)
            throw Error("Disposed or reentrant native animation sampler");
          const time32 = Math.fround(time),
            duration = Math.fround((resource.frames - 1) / resource.fps);
          if (
            !Number.isFinite(time) ||
            !Number.isFinite(time32) ||
            time32 < 0 ||
            time32 > duration ||
            typeof inheritScale !== "boolean"
          )
            throw Error(
              "Explicit finite in-range animation time and scale policy required",
            );
          if (
            !(rootPose instanceof Float32Array) ||
            rootPose.length !== 10 ||
            rootPose.some((v) => !Number.isFinite(v))
          )
            throw Error("Explicit finite root T/S/Q buffer required");
          const rootBytes = new Uint8Array(
            rootPose.buffer,
            rootPose.byteOffset,
            rootPose.byteLength,
          );
          checkOutput(output);
          running = true;
          try {
            resetPose();
            e.mem_write(root, rootBytes);
            let instructions = 0;
            k.callNative(
              resource.evaluatorRva,
              {
                RDI: resource.address,
                RSI: pose,
                RDX: mapping,
                RCX: cacheOwner ? cacheOwner + 0x58 : 0,
              },
              null,
              { XMM0: time32 },
            );
            instructions += k.lastExecutionBudget.instructions;
            if ((e.reg_read_i64(uc.X86_REG_RAX) & 255n) !== 1n)
              throw Error("Original ANM evaluation failed");
            const address = k.q(pose + 8);
            new Uint8Array(
              output.local.buffer,
              output.local.byteOffset,
              output.local.byteLength,
            ).set(k.read(address, count * 40));
            k.callNative(functions.world, {
              RDI: pose,
              RSI: root,
              RDX: inheritScale ? 1 : 0,
            });
            instructions += k.lastExecutionBudget.instructions;
            new Uint8Array(
              output.world.buffer,
              output.world.byteOffset,
              output.world.byteLength,
            ).set(k.read(address, count * 40));
            e.mem_write(skinOutput, skinBlank);
            k.callNative(functions.skin, { RDI: pose, RSI: skinOutput });
            instructions += k.lastExecutionBudget.instructions;
            new Uint8Array(
              output.skinMatrices.buffer,
              output.skinMatrices.byteOffset,
              output.skinMatrices.byteLength,
            ).set(k.read(skinOutput, count * 48));
            const revision = new DataView(k.read(pose, 4).buffer).getUint32(
                0,
                true,
              ),
              worldValid = k.read(pose + 4, 1)[0];
            if (
              revision !== 1 ||
              worldValid !== 1 ||
              k
                .read(
                  meta.poseTemplate.guardAddress,
                  meta.poseTemplate.guardBytes,
                )
                .some((v) => v !== 0xa5) ||
              (cacheOwner &&
                k.read(cacheOwner + 0x70, 0x100).some((v) => v !== 0xa5)) ||
              k.read(skinOutput + count * 48, 0x100).some((v) => v !== 0xa5) ||
              [output.local, output.world, output.skinMatrices].some((v) =>
                v.some((x) => !Number.isFinite(x)),
              )
            )
              throw Error(
                "Original animation validity, finite output or allocation guard differs",
              );
            output.revision = revision;
            output.worldValid = true;
            output.nativeInstructions = instructions;
            return output;
          } catch (error) {
            poisoned = true;
            throw error;
          } finally {
            running = false;
          }
        },
        dispose() {
          state.disposed = true;
          bindings.delete(state);
        },
      };
    },
    close() {
      if (!closed) {
        for (const state of bindings) state.disposed = true;
        bindings.clear();
        e.close();
        closed = true;
      }
    },
  });
}
