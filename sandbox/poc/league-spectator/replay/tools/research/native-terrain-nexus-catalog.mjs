import { actorSha256 as sha } from "../archived-actor-sources.mjs";
import { currentTerrainPositionBuild } from "./native-terrain-byte-codecs.mjs";
import { createPosition944ReaderFromCodecs } from "./native-terrain-positions-944-reader.mjs";
import {
  prepareNativeTerrainTurrets,
  turretPlacementReceiptDigests,
} from "./native-terrain-turrets.mjs";

export const nexusPlacements = Object.freeze([
  Object.freeze({ mapNameHash: 1341187095, skinId: 0 }),
  Object.freeze({ mapNameHash: 712301631, skinId: 3 }),
]);

export function bindNativeTerrainNexusCatalog(
  prepared,
  receipt,
  catalog,
  codecs,
  options,
  turrets,
) {
  const { build, protocol } = prepared.packetReader;
  if (
    build !== currentTerrainPositionBuild ||
    catalog?.schema !== 1 ||
    catalog.kind !== "exact-native-terrain-nexus-catalog" ||
    catalog.build !== build ||
    catalog.protocol !== protocol ||
    catalog.placementReceiptSha256 !== turretPlacementReceiptDigests[build] ||
    catalog.map?.installedMapSha256 !== receipt.installedSha256 ||
    catalog.map?.archivedMapSha256 !== receipt.archivedSha256 ||
    !Array.isArray(catalog.registration) ||
    catalog.registration.length !== 38 ||
    !Array.isArray(catalog.placeables) ||
    catalog.placeables.length !== 2
  )
    throw Error("Unexpected exact current Nexus catalog");
  const { opening } =
    turrets ?? prepareNativeTerrainTurrets(prepared, receipt, options);
  const turretAnchors = new Map(opening.map((row) => [row.mapNameHash, row]));
  const firstContext = turretAnchors.get(
    catalog.registration[0]?.mapNameHash,
  )?.context;
  if (!firstContext || turretAnchors.size !== 24)
    throw Error("Unexpected current Nexus registration cohort");
  const nexusContexts = new Map();
  const names = new Set();
  let barracks = 0;
  let inhibitors = 0;
  for (const [
    index,
    { mapNameHash, worldPosition, attackableType, kind },
  ] of catalog.registration.entries()) {
    const context = firstContext + index;
    if (
      !Number.isInteger(mapNameHash) ||
      mapNameHash < 1 ||
      mapNameHash > 0xffffffff ||
      names.has(mapNameHash) ||
      (kind !== "barracks" &&
        (kind !== "building" || ![0, 1, 2].includes(attackableType))) ||
      !Array.isArray(worldPosition) ||
      worldPosition.length !== 3 ||
      !worldPosition.every(Number.isFinite)
    )
      throw Error("Invalid or duplicate Nexus registration row");
    names.add(mapNameHash);
    if (kind === "barracks") {
      barracks++;
      continue;
    }
    if (attackableType === 1) inhibitors++;
    if (attackableType === 0) {
      const anchor = turretAnchors.get(mapNameHash);
      if (
        anchor?.context !== context ||
        anchor.worldPosition.some(
          (coordinate, axis) => coordinate !== worldPosition[axis],
        )
      )
        throw Error(
          "Nexus registration disagrees with a recorded turret anchor",
        );
      turretAnchors.delete(mapNameHash);
    }
    if (attackableType === 2)
      nexusContexts.set(mapNameHash, { context, worldPosition });
  }
  if (
    turretAnchors.size !== 0 ||
    nexusContexts.size !== 2 ||
    barracks !== 6 ||
    inhibitors !== 6
  )
    throw Error("Incomplete recorded Nexus anchors");
  const instances = nexusPlacements.map(({ mapNameHash, skinId }, index) => {
    const placement = catalog.placeables[index];
    const anchor = nexusContexts.get(mapNameHash);
    const { transform } = placement;
    if (
      anchor === undefined ||
      placement.mapNameHash !== mapNameHash ||
      placement.assetId !== `nexus-${skinId}` ||
      placement.characterRecord !== "Characters/Nexus/CharacterRecords/Root" ||
      !Array.isArray(transform) ||
      transform.length !== 16 ||
      !transform.every(Number.isFinite) ||
      [3, 7, 11, 15].some(
        (offset, i) => transform[offset] !== Number(i === 3),
      ) ||
      anchor.worldPosition.some((axis, i) => axis !== transform[12 + i])
    )
      throw Error("Invalid authored Nexus placement or appearance");
    return {
      context: anchor.context,
      mapNameHash,
      assetId: placement.assetId,
      characterRecord: placement.characterRecord,
      transform,
      placementSource: placement.placementSource,
      observedKeyframeSeconds: [],
      terminalState: "unverified",
    };
  });
  return {
    instances,
    ...corroborateNativeTerrainNexus(prepared, instances, codecs),
  };
}

const rotateByte = (byte, shift) =>
  ((byte << shift) | (byte >>> (8 - shift))) & 0xff;

function readNexusDeathCue(payload, decodeSyncByte) {
  // Factory 0x10198e6 and reader 0x1032910 select string reader 0x10a9760
  // for this three-byte header. The reader copies decoded text in reverse.
  if (
    payload.length !== 14 ||
    payload[0] !== 0xbe ||
    payload[1] !== 0xbf ||
    payload[2] !== 0xeb
  )
    throw Error("Unexpected reviewed Nexus animation packet header");
  // Recover the common 256-byte table by inverting the admitted sync-byte
  // transform. The exact build uses the same table at 0x21485c0 and 0x2148f00.
  const substitute = (byte) =>
    rotateByte((decodeSyncByte((byte - 0x64) & 0xff) - 0xed) & 0xff, 2) ^ 0xff;
  const decoded = Uint8Array.from(payload.subarray(3), (byte) => {
    const lookup = substitute((rotateByte(substitute(byte), 4) + 0xc7) & 0xff);
    const swapped = ((lookup >>> 1) & 0x55) | ((lookup << 1) & 0xaa);
    return (swapped + 0xcf) & 0xff;
  });
  if (decoded[0] !== decoded.length - 1)
    throw Error("Unexpected Nexus animation name length");
  const name = new TextDecoder("utf-8", { fatal: true }).decode(
    decoded.subarray(1).reverse(),
  );
  if (name !== "NexusDeath")
    throw Error("Unexpected reviewed Nexus animation name");
  return name;
}

export function corroborateNativeTerrainNexus(prepared, instances, codecs) {
  const { packetReader, observations } = prepared;
  const current = packetReader.build === currentTerrainPositionBuild;
  const readPosition = createPosition944ReaderFromCodecs(codecs);
  const byContext = new Map(
    instances.map((instance) => [instance.context, instance]),
  );
  const terminalPackets = [];
  const terminalLoss = current
    ? observations.structures?.find(
        ({ kind }) => kind === "match-ending-structure-loss",
      )
    : undefined;
  const terminalEvidence = [];
  if (current && (!terminalLoss || !byContext.has(terminalLoss.context)))
    throw Error("Expected a corroborated terminal Nexus loss");
  const frames = packetReader.keyframes;
  for (const [index, frame] of frames.entries()) {
    // A seek immediately before the next keyframe reads this snapshot and all
    // its preceding deltas. The footer bounds the final window.
    const cutoff =
      index + 1 === frames.length
        ? packetReader.durationSeconds
        : frames[index + 1].timeSeconds - 0.000001;
    const seenPosition = new Set();
    const seenSnapshot = new Set();
    let opcode;
    let context = 0;
    for (const packet of packetReader.read(cutoff).packets) {
      if (packet.blockOffset === 0) {
        opcode = undefined;
        context = 0;
      }
      opcode = packet.explicitOpcode ?? opcode;
      context =
        packet.marker & 32
          ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
          : packet.paramBits;
      const instance = byContext.get(context);
      if (!instance) continue;
      if (packet.stream === 2 && packet.chunkOffset === frame.chunkOffset) {
        if (opcode === 944) {
          const position = readPosition(packet.payload);
          if (
            !position ||
            position.x !== instance.transform[12] ||
            position.z !== instance.transform[14] ||
            seenPosition.has(context)
          )
            throw Error(
              "Recorded Nexus position differs from authored placement",
            );
          seenPosition.add(context);
        }
        // This is the 63-byte Nexus cohort, distinct from the 41-byte turret
        // state whose lifecycle bits have been verified.
        const nexusSnapshot = current
          ? Buffer.from(packet.payload).toString("hex") === "be71a6"
          : packet.payload.length === 63;
        if (opcode === 1012 && nexusSnapshot) {
          if (seenSnapshot.has(context))
            throw Error("Duplicate Nexus snapshot packet");
          seenSnapshot.add(context);
        }
      }
      if (packet.stream === 1 && opcode === 669) {
        terminalPackets.push({
          context,
          opcode,
          timeSeconds: packet.timeSeconds,
          payloadSha256: sha(packet.payload),
          animationName: readNexusDeathCue(
            packet.payload,
            codecs.decodeSyncByte,
          ),
        });
      }
      if (
        terminalLoss &&
        packet.stream === 1 &&
        opcode === 172 &&
        packet.payload.length === 116 &&
        context === terminalLoss.context &&
        packet.secondTimeBits === terminalLoss.secondTimeBits &&
        packet.timeSeconds === terminalLoss.timeSeconds
      )
        terminalEvidence.push({
          ...terminalLoss,
          opcode,
          payloadSha256: sha(packet.payload),
        });
    }
    for (const instance of instances) {
      if (
        (!current && !seenPosition.has(instance.context)) ||
        !seenSnapshot.has(instance.context)
      )
        throw Error(
          "Recorded Nexus position or independent snapshot is absent",
        );
      instance.observedKeyframeSeconds.push(frame.timeSeconds);
    }
  }
  if (current) {
    if (
      terminalEvidence.length !== 1 ||
      terminalPackets.length !== 0 ||
      terminalEvidence[0].timeSeconds <= frames.at(-1).timeSeconds
    )
      throw Error("Unexpected current Nexus terminal evidence");
  } else if (
    terminalPackets.length !== 1 ||
    terminalPackets[0].timeSeconds <= frames.at(-1).timeSeconds
  )
    throw Error("Unexpected reviewed Nexus terminal packet cohort");
  return { terminalPackets, terminalEvidence: terminalEvidence[0] };
}
