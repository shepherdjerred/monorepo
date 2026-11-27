import { createHash } from "node:crypto";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import {
  currentTerrainClientArchiveSha256,
  currentTerrainClientSliceSha256,
  currentTerrainPositionBuild,
  isExactTerrainReplay,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

const replicationSliceSha256 =
  "e4725bce602c14f5999ec83fae12eec239337caf77bdd5efacfe1b6299dec2aa";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const groups = [1, 2, 4, 8, 16, 32, 64];
const implicitRecordCounts = [0x7c, , , 0x81, , 0x87, 0x83];

const rotateByte = (byte, count) =>
  ((byte << count) | (byte >>> (8 - count))) & 0xff;
const swapBitPairs = (byte) => ((byte >>> 1) & 0x55) | ((byte << 1) & 0xaa);

function readReplicationPacket(payload, substitution) {
  if (payload.length < 2) throw Error("Truncated replication header");
  const flags = payload[0];
  let cursor = ((flags >>> 1) & 7) >= 4 ? 6 : 2;
  const readByte = () => {
    if (cursor >= payload.length) throw Error("Truncated replication field");
    return payload[cursor++];
  };
  const readVarint = (decode) => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const digit = decode(readByte());
      value += (digit & 127) * 2 ** shift;
      if (value > 0xffffffff) throw Error("Replication varint out of range");
      if ((digit & 128) === 0) return value;
    }
    throw Error("Unterminated replication varint");
  };
  const decodeVector = (byte) =>
    swapBitPairs(rotateByte(substitution[substitution[byte ^ 0xad]], 2));
  const decodeTail = (byte) =>
    rotateByte(
      substitution[(((byte << 1) | 0x54) + ((byte >>> 1) & 0x55)) & 0xff],
      6,
    );
  const length = flags & 1 ? 0 : readVarint(decodeVector);
  if (cursor + length > payload.length)
    throw Error("Truncated replication vector");
  const records = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) {
    const index = i & 1 ? length - 1 - (i >>> 1) : i >>> 1;
    records[index] = decodeVector(readByte());
  }
  const countSelector = (flags >>> 7) + ((payload[1] & 3) << 1);
  const codedCount = implicitRecordCounts[countSelector] ?? readByte();
  const count = rotateByte(codedCount, 7) ^ 0xc1;
  if ([0, 4, 5, 6].includes((flags >>> 4) & 7)) readVarint(decodeTail);
  if (cursor !== payload.length)
    throw Error("Unexpected replication packet data");
  return { records, count };
}

function* readEntityGroups({ records, count }, entities, accepts) {
  let cursor = 0;
  for (let record = 0; record < count; record += 1) {
    if (cursor + 5 > records.length)
      throw Error("Truncated replication record");
    const mask = records[cursor];
    if (mask & 128) throw Error("Unknown replication group bit");
    const participantId = records.readUInt32LE(cursor + 1);
    cursor += 5;
    for (const group of groups) {
      if ((mask & group) === 0) continue;
      if (cursor + 5 > records.length)
        throw Error("Truncated replication group");
      const fieldMask = records.readUInt32LE(cursor);
      const length = records[cursor + 4];
      cursor += 5;
      if (cursor + length > records.length)
        throw Error("Truncated replication group bytes");
      if (entities.has(participantId) && accepts(group, fieldMask)) {
        yield {
          group,
          participantId,
          fieldMask,
          bytes: records.subarray(cursor, cursor + length),
        };
      }
      cursor += length;
    }
  }
  if (cursor !== records.length)
    throw Error("Unexpected replication record data");
}

export function recordedEntityReplication(
  binary,
  rawReplay,
  sceneIdentity,
  entityIds,
  options,
) {
  const replay = openReplay(Uint8Array.from(rawReplay).buffer);
  const replaySha256 = sha256(rawReplay);
  if (
    !isExactTerrainReplay(replay, options) ||
    sceneIdentity.build !== replay.build ||
    sceneIdentity.protocol !== terrainPositionProtocol ||
    sceneIdentity.replaySha256 !== replaySha256
  )
    throw Error("Replay and independently bound scene must match the decoder");
  const currentBuild = replay.build === currentTerrainPositionBuild;
  const sliceSha256 = currentBuild
    ? currentTerrainClientSliceSha256
    : replicationSliceSha256;
  // The archive is inert. This address supplies the original opcode 309
  // wire substitution table from the verified exact-build slice.
  const slice = binary.subarray(0x4000, 0x4000 + 39_463_840);
  if (
    sha256(slice) !== sliceSha256 ||
    (currentBuild && sha256(binary) !== currentTerrainClientArchiveSha256)
  )
    throw Error("Wrong archived replication decoder");
  const substitution = slice.subarray(0x21485c0, 0x21486c0);
  const entities = new Set(entityIds);
  if (
    entities.size === 0 ||
    entities.size !== entityIds.length ||
    entityIds.some((id) => !Number.isInteger(id) || id < 1 || id > 0xffffffff)
  )
    throw Error("Unique independently bound replay entity identities required");

  const decompress = (bytes, output) =>
    zstdDecompressSync(bytes, { maxOutputLength: output.length });
  function* read() {
    const envelopes = replayTimedPacketEnvelopes(
      replayPacketEnvelopes(replay, decompress),
    );
    let opcode;
    for (const packet of envelopes) {
      if (packet.blockOffset === 0) opcode = undefined;
      opcode = packet.explicitOpcode ?? opcode;
      if (opcode !== 309 || (packet.stream !== 1 && !options.includeSnapshots))
        continue;
      const native = readReplicationPacket(packet.payload, substitution);
      for (const group of readEntityGroups(native, entities, options.accepts)) {
        yield {
          ...group,
          stream: packet.stream,
          timeSeconds: packet.timeSeconds,
        };
      }
    }
  }
  return {
    identity: {
      build: replay.build,
      protocol: terrainPositionProtocol,
      replaySha256,
      sliceSha256,
    },
    entities,
    read,
  };
}

export function recordedChampionReplication(binary, rawReplay, scene, options) {
  const entityIds = scene.participants.map(
    ({ participantId }) => participantId,
  );
  if (new Set(entityIds).size !== 10 || entityIds.length !== 10)
    throw Error("Ten independently bound replay champion identities required");
  const { identity, entities, read } = recordedEntityReplication(
    binary,
    rawReplay,
    scene.identity,
    entityIds,
    options,
  );
  return { identity, participants: entities, read };
}
