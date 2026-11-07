// Opcode-187 particle-entity removal. World lookup/type resolution is separate.
import { sha256 } from "./structural-comparison.mjs";

export const EFFECT_REMOVAL_PACKAGE_SHA =
  "9207772e0ef0cebce91880b7b57a96d88802ab9c4966130de3fb1e386a2cd81e";

export async function createLatestEffectRemovalReader(profile, image, bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    !(image instanceof Uint8Array) ||
    (await sha256(bytes)) !== EFFECT_REMOVAL_PACKAGE_SHA ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Pinned effect-removal decoder package required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-particle-entity-removal" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.constructorImageSha256 !== profile.constructorImageSha256 ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.opcode !== 187 ||
    meta.objectSize !== 24 ||
    meta.decoderRva !== profile.packets[187]?.entryRva ||
    meta.entityIdOffset !== 0x14 ||
    meta.reasonOffset !== 0x10 ||
    meta.defaultModeReason !== 61 ||
    meta.defaultFlagMask !== 0x800 ||
    meta.otherFlagMask !== 0x10000000 ||
    meta.handlerRva !== 0x8520d0 ||
    meta.getterBlock.join(",") !== [0x8520e4, 0x852157].join(",") ||
    meta.routingBlock.join(",") !== [0x852188, 0x8521b2].join(",") ||
    meta.propagationBlock.join(",") !== [0x1765bfe, 0x1765cce].join(",") ||
    meta.particleVtableRva !== 0x231be40 ||
    meta.stopVirtualOffset !== 0x208 ||
    !meta.scope.worldLookupResolvedByCaller ||
    meta.scope.worldRegistryExecuted ||
    meta.scope.typeCastExecuted ||
    meta.scope.missilePresentationInterfaceBound ||
    meta.scope.mainViewerIntegrated
  )
    throw Error("Unsupported effect-removal field/routing contract");
  for (const block of meta.sourceBlocks)
    if (
      (await sha256(image.subarray(block.startRva, block.endRva))) !==
      block.sha256
    )
      throw Error("Original effect-removal instructions changed");
  if (
    (await sha256(
      image.subarray(
        meta.dispatchTableRva,
        meta.dispatchTableRva + meta.dispatchTableBytes,
      ),
    )) !== meta.dispatchTableSha256 ||
    meta.entityIdDecode.length !== 4 ||
    meta.entityIdDecode.some(
      (column) =>
        column.length !== 256 ||
        new Set(column).size !== 256 ||
        column.some((n) => !Number.isInteger(n) || n < 0 || n > 255),
    )
  )
    throw Error("Invalid effect-removal dispatch or byte codec");
  return {
    metadata: meta,
    read(observation) {
      const object = observation?.object;
      if (
        !observation?.complete ||
        !(object instanceof Uint8Array) ||
        object.length !== 24 ||
        new DataView(
          object.buffer,
          object.byteOffset,
          object.byteLength,
        ).getUint32(8, true) !== 187
      )
        throw Error("Incomplete opcode-187 particle-removal object");
      const decoded = Uint8Array.from(
          object.subarray(0x14, 0x18),
          (value, lane) => meta.entityIdDecode[lane][value],
        ),
        reasonByte = object[0x10];
      return {
        kind: "particle-entity-removal",
        opcode: 187,
        entityId: new DataView(decoded.buffer).getUint32(0, true),
        contextId: new DataView(
          object.buffer,
          object.byteOffset,
          object.byteLength,
        ).getUint32(12, true),
        reasonByte,
        requestedFlagMask: reasonByte === 61 ? 0x800 : 0x10000000,
      };
    },
    // Controlled composition of an already resolved particle entity. This does
    // not claim a replay ID belongs to that class or install a world registry.
    routeResolvedParticleEntity(
      retirement,
      reasonByte,
      initialObjectFlags,
      effectPresent,
    ) {
      if (
        !retirement?.ready ||
        retirement.closed ||
        retirement.metadata.retireRva !== 0x1761b00 ||
        !Number.isInteger(reasonByte) ||
        reasonByte < 0 ||
        reasonByte > 255 ||
        !Number.isInteger(initialObjectFlags) ||
        initialObjectFlags < 0 ||
        initialObjectFlags > 0xffffffff ||
        typeof effectPresent !== "boolean"
      )
        throw Error(
          "Explicit resolved particle-entity routing inputs required",
        );
      const k = retirement.runtime.kernel,
        packet = 0x100f1000,
        entity = 0x100f2000,
        object = 0x100f3000;
      const saved = [
        [packet, 24],
        [entity, 0x300],
        [object, 0x238],
      ].map(([at, length]) => [at, k.read(at, length)]);
      function fragment(start, end, registers) {
        const hook = k.engine.hook_add(
          k.uc.HOOK_CODE,
          () => k.engine.emu_stop(),
          null,
          k.base + end,
          k.base + end,
        );
        try {
          k.callNative(start, registers, end);
        } finally {
          k.engine.hook_del(hook);
        }
      }
      try {
        for (const [at, bytes] of saved)
          k.engine.mem_write(at, new Uint8Array(bytes.length));
        k.put(packet + 0x10, [reasonByte], "u8");
        k.u64(entity, k.base + meta.particleVtableRva);
        k.put(object + 0x18, [initialObjectFlags], "u32");
        k.u64(object + 0x28, k.a.system);
        k.u64(entity + 0x178, effectPresent ? object : 0);
        fragment(...meta.routingBlock, { RBX: packet, RAX: entity });
        const objectFlags = k.readU32(object + 0x18);
        if (effectPresent) fragment(...meta.propagationBlock, { RBX: object });
        const life = retirement.lifecycle();
        return {
          reasonByte,
          initialObjectFlags,
          effectPresent,
          objectFlags,
          entityEffectPointer: k.q(entity + 0x178),
          rootFlags: life.flags,
          queued: life.lists.retiring.count,
        };
      } finally {
        for (const [at, bytes] of saved) k.engine.mem_write(at, bytes);
      }
    },
  };
}
