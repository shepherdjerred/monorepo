// Exact-build native emission control on an already admitted quad runtime.
// The supplied boolean is not inferred from missile stops or effect retirement.
import { sha256 } from "./structural-comparison.mjs";

export async function createLatestVfxControl(
  runtime,
  profile,
  image,
  bytes,
  expectedSha256,
) {
  if (
    !(image instanceof Uint8Array) ||
    !(bytes instanceof Uint8Array) ||
    (await sha256(bytes)) !== expectedSha256 ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Pinned native emission-control package required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-emitter-birth-suppression" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.quadPackageSha256 !== profile.vfxBoundQuadsSha256 ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.runtimeSha256 !==
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716" ||
    runtime?.metadata?.build !== meta.build ||
    runtime.metadata.decoderImageSha256 !== meta.decoderImageSha256 ||
    meta.controlAddress !== 0x100f0000 ||
    meta.actorListAddress !== 0x100f0400 ||
    meta.scratchBytes !== 0x500 ||
    meta.setterRva !== 0x1767070 ||
    meta.propagationBlock.join(",") !== "24535493,24535619" ||
    meta.sourceBlocks.length !== 2 ||
    meta.scope.complexEmitters !== 1 ||
    meta.scope.meshSiblings !== 0 ||
    meta.scope.systemRetirement ||
    meta.scope.replayEventMapping ||
    meta.scope.mainViewerIntegrated
  )
    throw Error("Unsupported native emission-control contract");
  for (const block of meta.sourceBlocks)
    if (
      (await sha256(image.subarray(block.startRva, block.endRva))) !==
      block.sha256
    )
      throw Error("Original emission-control instructions changed");
  const k = runtime.kernel,
    a = k.a;
  let closed = false;
  return {
    applySuspended(suspended) {
      if (
        closed ||
        runtime.closed ||
        !runtime.ready ||
        typeof suspended !== "boolean"
      )
        throw Error(
          "Initialized native quad runtime and explicit suspension boolean required",
        );
      const scratch = k.read(meta.controlAddress, meta.scratchBytes),
        lists = [a.system + 0x40, a.system + 0x60].map((address) => ({
          address,
          data: k.read(address, 16),
        }));
      try {
        k.engine.mem_write(
          meta.controlAddress,
          new Uint8Array(meta.scratchBytes),
        );
        k.u64(meta.controlAddress + 0x28, a.system);
        k.u64(meta.actorListAddress, a.actor);
        k.u64(a.system + 0x40, meta.actorListAddress);
        k.put(a.system + 0x48, [1, 1], "u32");
        k.u64(a.system + 0x60, 0);
        k.put(a.system + 0x68, [0, 0], "u32");
        const before = k.read(a.actor + 0x18, 1)[0];
        k.callNative(meta.setterRva, {
          RDI: meta.controlAddress,
          RSI: Number(suspended),
        });
        const [start, end] = meta.propagationBlock;
        const hook = k.engine.hook_add(
          k.uc.HOOK_CODE,
          () => k.engine.emu_stop(),
          null,
          k.base + end,
          k.base + end,
        );
        try {
          k.callNative(start, { RBX: meta.controlAddress }, end);
        } finally {
          k.engine.hook_del(hook);
        }
        const after = k.read(a.actor + 0x18, 1)[0];
        if (after !== ((before & ~2) | (Number(suspended) << 1)))
          throw Error("Native birth-suppression flag differs");
        return {
          before,
          after,
          objectValue: k.read(meta.controlAddress + 0x1b8, 1)[0],
          objectDirty: k.read(meta.controlAddress + 0x1a, 1)[0],
        };
      } finally {
        k.engine.mem_write(meta.controlAddress, scratch);
        for (const list of lists) k.engine.mem_write(list.address, list.data);
      }
    },
    close() {
      closed = true;
    },
    scope:
      "Original reversible birth suppression with a supplied boolean. Existing particles continue native updates/removal. Scratch object/list restored; no retirement, replay policy, audio/mesh siblings or renderer integration.",
  };
}
