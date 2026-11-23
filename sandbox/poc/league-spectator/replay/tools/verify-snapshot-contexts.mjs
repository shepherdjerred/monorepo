import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { buildReplayKeyframeIndex } from "../replay-keyframe-index.mjs";
import { openReplay, replayPacketEnvelopes } from "../transport.mjs";

const snapshotOpcode = 313;
const overlapOpcode = 75;
const snapshotBytes = 1263;
const partitionOffset = 1230;

/** Verify observed context and team structure without binding individual rows. */
export function verifySnapshotContexts(index, roster, envelopes) {
  const teams = roster.map(({ team }) => team);
  if (
    teams.length !== 10 ||
    !Number.isInteger(teams[0]) ||
    !Number.isInteger(teams[5]) ||
    teams[0] === teams[5] ||
    !teams.every((team, ordinal) => team === teams[ordinal < 5 ? 0 : 5])
  )
    throw Error("Expected two contiguous five-participant footer groups");
  const snapshots = new Map(index.map(({ chunkOffset }) => [chunkOffset, []]));
  const openingOffset = index[0]?.chunkOffset;
  const openingTemplates = [];
  const gameplayCounts = new Map();
  let opcode = null;
  let signed = 0;
  let unsigned = 0;
  let gameplayTotal = 0;
  for (const record of envelopes) {
    if (record.blockOffset === 0) {
      opcode = null;
      signed = unsigned = 0;
    }
    if (record.explicitOpcode !== null) opcode = record.explicitOpcode;
    const { marker, paramBits, stream, chunkOffset, payload } = record;
    signed =
      marker & 32 ? (signed + ((paramBits << 24) >> 24)) >>> 0 : paramBits;
    unsigned = marker & 32 ? (unsigned + paramBits) >>> 0 : paramBits;
    if (opcode === snapshotOpcode) {
      const snapshot = snapshots.get(chunkOffset);
      if (
        stream !== 2 ||
        !snapshot ||
        record.explicitOpcode !== snapshotOpcode ||
        payload.length !== snapshotBytes ||
        signed !== unsigned
      )
        throw Error("Unexpected opcode 313 snapshot record");
      if (snapshot.length === 10)
        throw Error("Expected ten records in every snapshot");
      snapshot.push({ context: signed, partition: payload[partitionOffset] });
      if (chunkOffset === openingOffset)
        openingTemplates.push(new Uint8Array(payload));
    }
    if (stream === 1 && opcode === overlapOpcode) {
      gameplayTotal++;
      gameplayCounts.set(signed, (gameplayCounts.get(signed) ?? 0) + 1);
    }
  }

  const opening = snapshots.values().next().value;
  if (opening?.length !== 10)
    throw Error("Expected ten opening snapshot records");
  const reference = openingTemplates[0];
  for (const [ordinal, payload] of openingTemplates.entries()) {
    if (
      payload[partitionOffset] !== opening[ordinal < 5 ? 0 : 5].partition ||
      payload.some(
        (byte, offset) =>
          offset !== partitionOffset && byte !== reference[offset],
      )
    )
      throw Error(
        "Opening snapshot templates disagree with the observed partition",
      );
  }
  if (opening[0].partition === opening[5].partition)
    throw Error("Opening snapshot templates have no partition");

  const baseContext = opening[0].context;
  for (const snapshot of snapshots.values()) {
    if (snapshot.length !== 10)
      throw Error("Expected ten records in every snapshot");
    if (
      !snapshot.every(
        ({ context, partition }, ordinal) =>
          context === baseContext + ordinal &&
          partition === opening[ordinal].partition,
      )
    )
      throw Error("Snapshot context or partition differs from the opening");
  }

  const overlappingCounts = opening.map(
    ({ context }) => gameplayCounts.get(context) ?? 0,
  );
  if (overlappingCounts.some((count) => count === 0))
    throw Error("Gameplay opcode 75 does not overlap all snapshot contexts");
  return {
    snapshotOpcode,
    snapshotCount: snapshots.size,
    payloadBytes: snapshotBytes,
    contextsPerSnapshot: opening.length,
    recordsVerified: snapshots.size * opening.length,
    partitionOffset,
    partitionSizes: [5, 5],
    gameplayOverlap: {
      opcode: overlapOpcode,
      contextHypothesis: "signed-i8",
      distinctOverlappingContexts: overlappingCounts.length,
      overlappingRecords: overlappingCounts.reduce(
        (sum, count) => sum + count,
        0,
      ),
      totalRecords: gameplayTotal,
    },
  };
}

if (import.meta.main) {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length)
    throw Error("Usage: node verify-snapshot-contexts.mjs <replay.rofl>");
  const bytes = readFileSync(path);
  const replay = openReplay(new Uint8Array(bytes).buffer);
  const decompress = (stored, target) =>
    zstdDecompressSync(stored, { maxOutputLength: target.byteLength });
  const index = buildReplayKeyframeIndex(replay, decompress);
  const result = verifySnapshotContexts(
    index,
    replay.roster,
    replayPacketEnvelopes(replay, decompress),
  );
  console.log(
    JSON.stringify(
      {
        build: replay.build,
        protocol: replay.protocol,
        replaySha256: createHash("sha256").update(bytes).digest("hex"),
        ...result,
      },
      null,
      2,
    ),
  );
}
