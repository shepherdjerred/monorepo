// Original opcode-756 getters. Creation factories and world lookup are separate.
import { sha256 } from "./structural-comparison.mjs";

export const EFFECT_CREATION_PACKAGE_SHA =
  "6f770293815e5d9033859c140658a70d219e90b25330407b848600f0823bdb7d";

export async function createLatestEffectCreationReader(profile, image, bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    !(image instanceof Uint8Array) ||
    (await sha256(bytes)) !== EFFECT_CREATION_PACKAGE_SHA ||
    (await sha256(image)) !== profile.decoderImageSha256
  )
    throw Error("Pinned effect-creation decoder package required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-particle-creation-fields" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    profile.clientVersion !== meta.build ||
    profile.protocolDigest !== meta.protocol ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.constructorImageSha256 !== profile.constructorImageSha256 ||
    meta.sliceSha256 !==
      "6c2295282e20e2e65b62c0a28095d330233d2e8e16c246d8601aaa6ee3f6d64b" ||
    meta.opcode !== 756 ||
    meta.decoderRva !== profile.packets[756]?.entryRva ||
    meta.objectSize !== 32 ||
    meta.arenaBase !== 0x10200000 ||
    meta.groupStride !== 0x50 ||
    meta.entryStride !== 0xb8 ||
    Object.values(meta.scope).some(Boolean)
  )
    throw Error("Unsupported effect-creation field contract");
  for (const block of meta.sourceBlocks)
    if (
      (await sha256(image.subarray(block.startRva, block.endRva))) !==
      block.sha256
    )
      throw Error("Original effect-creation instructions changed");
  if (
    (await sha256(
      image.subarray(
        meta.dispatchTableRva,
        meta.dispatchTableRva + meta.dispatchTableBytes,
      ),
    )) !== meta.dispatchTableSha256 ||
    Object.values(meta.fields).some(
      (field) =>
        !["entry", "group"].includes(field.owner) ||
        ![2, 4].includes(field.width) ||
        field.decode.length !== field.width ||
        field.decode.some(
          (column) =>
            column.length !== 256 ||
            new Set(column).size !== 256 ||
            column.some(
              (value) => !Number.isInteger(value) || value < 0 || value > 255,
            ),
        ),
    )
  )
    throw Error("Invalid effect-creation dispatch or byte codec");

  function decodeField(name, encoded) {
    const field = meta.fields[name];
    if (
      !field ||
      !(encoded instanceof Uint8Array) ||
      encoded.length !== field.width
    )
      throw Error("Exact effect-creation field bytes required");
    let result = 0;
    for (let lane = 0; lane < field.width; lane++)
      result += field.decode[lane][encoded[lane]] * 2 ** (lane * 8);
    return result;
  }
  function fields(owner, value) {
    return Object.fromEntries(
      Object.entries(meta.fields)
        .filter(([, field]) => field.owner === owner)
        .map(([name, field]) => [
          name,
          decodeField(
            name,
            value.subarray(field.offset, field.offset + field.width),
          ),
        ]),
    );
  }
  const signed16 = (value) => (value << 16) >> 16;
  return {
    metadata: meta,
    decodeField,
    read(observation) {
      const { object, heap } = observation ?? {};
      if (
        !observation?.complete ||
        !(object instanceof Uint8Array) ||
        object.length !== 32 ||
        !(heap instanceof Uint8Array) ||
        heap.length < 32 ||
        object.some((byte, index) => byte !== heap[index]) ||
        new DataView(object.buffer, object.byteOffset, object.length).getUint32(
          8,
          true,
        ) !== 756
      )
        throw Error("Incomplete opcode-756 particle-creation object");
      const view = (bytes) =>
        new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      function vector(container, pointerOffset, countOffset, stride) {
        const data = view(container),
          count = data.getUint32(countOffset, true),
          pointer = data.getBigUint64(pointerOffset, true);
        if (count === 0) return [];
        const offset = pointer - BigInt(meta.arenaBase),
          length = BigInt(count) * BigInt(stride);
        if (
          offset < 0n ||
          offset % 8n !== 0n ||
          offset + length > BigInt(heap.length)
        )
          throw Error("Effect-creation vector exceeds decoded arena");
        return Array.from({ length: count }, (_, index) =>
          heap.subarray(
            Number(offset) + index * stride,
            Number(offset) + (index + 1) * stride,
          ),
        );
      }
      return vector(
        object,
        meta.groupPointerOffset,
        meta.groupCountOffset,
        meta.groupStride,
      ).flatMap((group, groupIndex) => {
        const common = fields("group", group);
        return vector(
          group,
          meta.entryPointerOffset,
          meta.entryCountOffset,
          meta.entryStride,
        ).map((entry, entryIndex) => {
          const decoded = fields("entry", entry),
            bits = new DataView(new ArrayBuffer(4));
          bits.setUint32(0, decoded.positionHeightBits, true);
          const height = bits.getFloat32(0, true);
          if (!Number.isFinite(height))
            throw Error("Nonfinite effect-creation height");
          return {
            kind: "particle-entity-creation-fields",
            opcode: 756,
            groupIndex,
            entryIndex,
            ...common,
            ...decoded,
            positionFields: {
              xGrid: signed16(decoded.positionXGridBits),
              height,
              zGrid: signed16(decoded.positionZGridBits),
              coordinateSpace: "signed16-relative-grid-and-float-height",
              worldPositionResolved: false,
              attachmentOverrideResolved: false,
            },
          };
        });
      });
    },
  };
}

// This inspects the caller's explicit entity/skin context. It does not search all
// skins for a coincidentally matching key, guess a missing owner, or fall back to
// a default skin. Native factory, resolver precedence and attachment are pending.
export function bindLatestCreationResources(report, manifest) {
  if (
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e" ||
    manifest.build !== report.build ||
    manifest.protocol !== report.protocol ||
    !Array.isArray(report.effectCreations)
  )
    throw Error(
      "Matching particle-creation report and effect catalog required",
    );
  const heroes = new Map(report.heroes.map((hero) => [hero.entityId, hero]));
  return report.effectCreations.map((record) => {
    const hero = heroes.get(record.resourceContextEntityId),
      actorKey = hero
        ? `champions/${hero.champion.toLowerCase()}/${hero.skinId}`
        : null,
      actor = actorKey ? manifest.actors[actorKey] : null,
      resource =
        actor?.resources[record.resourceKey.toString(16).padStart(8, "0")];
    let status;
    if (record.resourceKey === 0) status = "alternate-name-registry-unresolved";
    else if (!hero) status = "resource-context-entity-unresolved";
    else if (!actor) status = "context-skin-catalog-unprepared";
    else if (!resource) status = "resource-key-absent-from-context-catalog";
    else if (resource.status !== "prepared-definition")
      status = resource.status;
    else {
      if (!manifest.definitions[resource.effectId])
        throw Error(
          "Creation resource references a missing prepared definition",
        );
      status = "prepared-context-resource";
    }
    return {
      creationSequence: record.creationSequence,
      entityId: record.entityId,
      resourceKey: record.resourceKey,
      resourceContextEntityId: record.resourceContextEntityId,
      actorKey,
      status,
      effectId:
        status === "prepared-context-resource" ? resource.effectId : null,
      nativeFactoryExecuted: false,
    };
  });
}
