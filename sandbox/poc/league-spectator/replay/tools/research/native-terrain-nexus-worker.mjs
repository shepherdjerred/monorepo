import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import { resolveNativeTerrainNexusPlacement } from "./native-terrain-nexus-placement.mjs";
import { createPosition944ReaderFromCodecs } from "./native-terrain-positions-944-reader.mjs";
import { prepareNativeTerrainTurretOpening } from "./native-terrain-turrets.mjs";

export function createCurrentNexusEvidenceCollector(
  packetReader,
  loss,
  placements,
  readPosition,
) {
  const instances = new Map(
    placements.map(({ context, position }) => [context, position]),
  );
  const { keyframes, durationSeconds } = packetReader;
  const lastFrame = keyframes.at(-1);
  if (
    !instances.has(loss?.context) ||
    lastFrame === undefined ||
    !(
      loss.timeSeconds > lastFrame.timeSeconds &&
      loss.timeSeconds <= durationSeconds
    )
  )
    throw Error("Expected a corroborated terminal Nexus loss");
  const snapshots = new Map(
    keyframes.map(({ chunkOffset }) => [
      chunkOffset,
      {
        positions: new Set(),
        markers: new Set(),
      },
    ]),
  );
  let opcode;
  let context = 0;
  let terminalPayload;
  function observe(packet) {
    if (packet.blockOffset === 0) {
      opcode = undefined;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    const position = instances.get(context);
    if (position === undefined) return;
    const { stream, chunkOffset, timeSeconds, payload, secondTimeBits } =
      packet;
    if (stream === 2) {
      const snapshot = snapshots.get(chunkOffset);
      if (snapshot === undefined) return;
      if (opcode === 944) {
        const decoded = readPosition(payload);
        if (
          !decoded ||
          decoded.x !== position[0] ||
          decoded.z !== position[2] ||
          snapshot.positions.has(context)
        )
          throw Error(
            "Recorded Nexus position differs from authored placement",
          );
        snapshot.positions.add(context);
      }
      if (
        opcode === 1012 &&
        payload.length === 3 &&
        payload[0] === 0xbe &&
        payload[1] === 0x71 &&
        payload[2] === 0xa6
      ) {
        if (snapshot.markers.has(context))
          throw Error("Duplicate Nexus snapshot packet");
        snapshot.markers.add(context);
      }
      return;
    }
    if (stream !== 1) return;
    if (opcode === 669)
      throw Error("Unexpected current Nexus animation packet");
    if (
      opcode === 172 &&
      payload.length === 116 &&
      context === loss.context &&
      secondTimeBits === loss.secondTimeBits &&
      timeSeconds === loss.timeSeconds
    ) {
      if (terminalPayload !== undefined)
        throw Error("Duplicate recorded Nexus terminal packet");
      terminalPayload = payload.slice();
    }
  }

  return {
    observe,
    async finish() {
      if (
        [...snapshots.values()].some(
          ({ markers }) => markers.size !== instances.size,
        )
      )
        throw Error("Recorded Nexus independent snapshot is absent");
      if (terminalPayload === undefined)
        throw Error("Recorded Nexus terminal packet is absent");
      const digest = await globalThis.crypto.subtle.digest(
        "SHA-256",
        terminalPayload,
      );
      const payloadSha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      return {
        context: loss.context,
        timeSeconds: loss.timeSeconds,
        payloadSha256,
      };
    },
  };
}

export function createCurrentReplayNexusCollector(
  prepared,
  catalog,
  codecs,
  turretOpening,
) {
  const { packetReader, observations } = prepared;
  if (
    packetReader.build !== currentTerrainPositionBuild ||
    packetReader.protocol !== terrainPositionProtocol ||
    catalog?.build !== packetReader.build ||
    catalog.protocol !== packetReader.protocol ||
    Object.hasOwn(catalog, "replaySha256") ||
    !Array.isArray(catalog.registration) ||
    catalog.registration.length !== 38 ||
    !Array.isArray(catalog.placeables) ||
    catalog.placeables.length !== 2 ||
    !Array.isArray(catalog.models) ||
    catalog.models.length !== 2
  )
    throw Error("Expected the exact build-scoped Map11 Nexus catalog");
  const models = new Map(catalog.models);
  if (models.get("nexus-0") !== 100 || models.get("nexus-3") !== 101)
    throw Error("Expected two distinct authored Nexus models");
  const opening =
    turretOpening ??
    prepareNativeTerrainTurretOpening(packetReader, catalog.placementReceipt, {
      allowCurrentBuild: true,
    });
  const instances = resolveNativeTerrainNexusPlacement(
    catalog.registration,
    catalog.placeables,
    [...opening].map(([context, row]) => ({ context, ...row })),
  ).map(({ context, assetId, transform }) => ({
    context,
    participantId: models.get(assetId),
    position: transform.slice(12, 15),
    basis: [
      ...transform.slice(0, 3),
      ...transform.slice(4, 7),
      ...transform.slice(8, 11),
    ],
  }));
  const losses = observations.structures?.filter(
    ({ kind }) => kind === "match-ending-structure-loss",
  );
  if (losses?.length !== 1)
    throw Error("Expected one independently verified Nexus loss");
  const evidence = createCurrentNexusEvidenceCollector(
    packetReader,
    losses[0],
    instances,
    createPosition944ReaderFromCodecs(codecs),
  );
  return {
    instances,
    observe: evidence.observe,
    async finish() {
      return {
        nexusModels: { instances, terminalLoss: await evidence.finish() },
      };
    },
  };
}
