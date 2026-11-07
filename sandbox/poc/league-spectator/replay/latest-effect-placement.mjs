// Packet vectors in native world coordinates. Entity/bone overrides are pending.
import { sha256 } from "./structural-comparison.mjs";
import { latestMovementOrigin } from "./latest-movement.mjs";
import { assertLatestSelectedEffectPacket } from "./latest-selected-effect-packets.mjs";
import { EFFECT_PLACEMENT_PACKAGE_SHA } from "./latest-effect-packet-contract.mjs";
export { EFFECT_PLACEMENT_PACKAGE_SHA } from "./latest-effect-packet-contract.mjs";
import {
  createLatestEffectCreationReader,
  EFFECT_CREATION_PACKAGE_SHA,
} from "./latest-effect-creation.mjs";

export async function createLatestEffectPlacementReader(
  profile,
  image,
  creationBytes,
  placementBytes,
  sceneBytes,
  staticCatalog = null,
) {
  if (
    !(placementBytes instanceof Uint8Array) ||
    !(sceneBytes instanceof Uint8Array) ||
    (staticCatalog === null &&
      (await sha256(placementBytes)) !== EFFECT_PLACEMENT_PACKAGE_SHA)
  )
    throw Error("Pinned effect-placement decoder and scene bytes required");
  if (staticCatalog !== null)
    await assertLatestSelectedEffectPacket({
      selection: staticCatalog,
      kind: "placement",
      profile,
      packageBytes: placementBytes,
      sceneBytes,
    });
  const meta = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(placementBytes),
    ),
    scene = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(sceneBytes),
    ),
    creation = await createLatestEffectCreationReader(
      profile,
      image,
      creationBytes,
    );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-particle-placement-fields" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.constructorImageSha256 !== profile.constructorImageSha256 ||
    meta.sliceSha256 !== creation.metadata.sliceSha256 ||
    meta.creationPackageSha256 !== EFFECT_CREATION_PACKAGE_SHA ||
    meta.sceneManifestSha256 !== (await sha256(sceneBytes)) ||
    scene.build !== meta.build ||
    scene.protocol !== meta.protocol ||
    meta.mapId !== scene.map.id ||
    meta.mapVariant !== scene.map.variant ||
    JSON.stringify(meta.mapMin) !== JSON.stringify(scene.map.min) ||
    JSON.stringify(meta.mapMax) !== JSON.stringify(scene.map.max) ||
    meta.scaleBits !== 0x40000000 ||
    meta.quantizationGlobalsRva !== 0x2539f80 ||
    JSON.stringify(meta.origin) !==
      JSON.stringify(latestMovementOrigin(scene.map.min, scene.map.max)) ||
    JSON.stringify(meta.origin) !== JSON.stringify(scene.map.movementOrigin) ||
    !meta.scope.mapInitializationExecuted ||
    !meta.scope.packetVectorGettersExecuted ||
    meta.scope.entityOverrideExecuted ||
    meta.scope.attachmentPoseExecuted ||
    meta.scope.factoryExecuted ||
    meta.scope.mainViewerIntegrated
  )
    throw Error("Unsupported effect-placement/map contract");
  for (const block of meta.sourceBlocks)
    if (
      (await sha256(image.subarray(block.startRva, block.endRva))) !==
      block.sha256
    )
      throw Error("Original effect-placement instructions changed");
  for (const field of Object.values(meta.fields))
    if (
      ![2, 4].includes(field.width) ||
      field.offset < 0 ||
      field.offset + field.width > 0xb8 ||
      field.decode.length !== field.width ||
      field.decode.some(
        (column) =>
          column.length !== 256 ||
          new Set(column).size !== 256 ||
          column.some(
            (value) => !Number.isInteger(value) || value < 0 || value > 255,
          ),
      )
    )
      throw Error("Invalid effect-placement byte codec");
  const f = Math.fround,
    scratch = new DataView(new ArrayBuffer(4));
  const asFloat = (bits) => {
    scratch.setUint32(0, bits, true);
    const value = scratch.getFloat32(0, true);
    if (!Number.isFinite(value))
      throw Error("Nonfinite effect-placement height");
    return value;
  };
  function coordinate(axis, value) {
    if (
      ![0, 2].includes(axis) ||
      !Number.isInteger(value) ||
      value < -32768 ||
      value > 32767
    )
      throw Error("Signed16 grid coordinate and native X/Z axis required");
    return f(f(value * 2) + meta.origin[axis === 0 ? 0 : 1]);
  }
  function decodeField(name, encoded) {
    const field = meta.fields[name];
    if (
      !field ||
      !(encoded instanceof Uint8Array) ||
      encoded.length !== field.width
    )
      throw Error("Exact effect-placement field bytes required");
    let result = 0;
    for (let lane = 0; lane < field.width; lane++)
      result += field.decode[lane][encoded[lane]] * 2 ** (lane * 8);
    return result;
  }
  const signed = (bits) => (bits << 16) >> 16;
  return {
    metadata: meta,
    coordinate,
    decodeField,
    read(observation) {
      const records = creation.read(observation),
        heap = observation.heap,
        view = new DataView(heap.buffer, heap.byteOffset, heap.byteLength),
        gp =
          Number(view.getBigUint64(0x10, true)) - creation.metadata.arenaBase;
      return records.map((record) => {
        // The creation reader has already checked every pointer, count, stride
        // and arena boundary in this same immutable observation.
        const ep =
            Number(
              view.getBigUint64(gp + record.groupIndex * 0x50 + 0x38, true),
            ) - creation.metadata.arenaBase,
          entry = heap.subarray(
            ep + record.entryIndex * 0xb8,
            ep + (record.entryIndex + 1) * 0xb8,
          ),
          fields = Object.fromEntries(
            Object.entries(meta.fields).map(([name, field]) => [
              name,
              decodeField(
                name,
                entry.subarray(field.offset, field.offset + field.width),
              ),
            ]),
          );
        const second = [
            coordinate(0, signed(fields.secondXGridBits)),
            asFloat(fields.secondHeightBits),
            coordinate(2, signed(fields.secondZGridBits)),
          ],
          third = [
            coordinate(0, signed(fields.thirdXGridBits)),
            asFloat(fields.thirdHeightBits),
            coordinate(2, signed(fields.thirdZGridBits)),
          ];
        return {
          entityId: record.entityId,
          groupIndex: record.groupIndex,
          entryIndex: record.entryIndex,
          primaryPacketPosition: [
            coordinate(0, record.positionFields.xGrid),
            record.positionFields.height,
            coordinate(2, record.positionFields.zGrid),
          ],
          secondaryPacketVector: second,
          tertiaryPacketVector: third,
          resourceContextEntityId: record.resourceContextEntityId,
          attachmentEntityId: record.attachmentEntityId,
          lookup14EntityId: record.lookup14EntityId,
          lookupA8EntityId: record.lookupA8EntityId,
          additionalFields: fields,
          coordinateSpace: "native-world",
          packetVectorsResolved: true,
          worldPlacementResolved: false,
          entityOverrideResolved: false,
          attachmentPoseResolved: false,
        };
      });
    },
  };
}
