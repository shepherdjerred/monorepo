import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { replayPacketEnvelopes } from "../../transport.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

const missileCreate = 639;
const teamMaskSet = 66;

function isReviewedMaskSet(opcode, payload) {
  // The original consumer writes only its team mask for these two bodies.
  return (
    opcode === teamMaskSet &&
    payload.length === 2 &&
    payload[0] === 0x77 &&
    (payload[1] === 0x8f || payload[1] === 0xdb)
  );
}

/**
 * Find the replay-authorized all-vision prefix of each decoded missile.
 *
 * The first unreviewed actor packet closes the playable interval. Its clock
 * does not establish the missile's semantic stop time.
 */
export function collectRiftProjectileVisiblePrefixes(
  replay,
  inflate,
  decodeLaunch,
  verifiedOwners,
) {
  if (
    replay.build !== currentTerrainPositionBuild ||
    replay.protocol !== terrainPositionProtocol
  )
    throw new Error("Recorded projectile packet build or protocol differs");
  if (verifiedOwners.size === 0) return [];

  const active = new Map();
  const result = [];
  let context = 0;
  let opcode;
  let sequence = 0;
  for (const packet of replayTimedPacketEnvelopes(
    replayPacketEnvelopes(replay, inflate),
  )) {
    sequence++;
    if (packet.blockOffset === 0) {
      opcode = undefined;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (packet.stream !== 1) continue;

    const open = active.get(context);
    if (open !== undefined) {
      if (isReviewedMaskSet(opcode, packet.payload)) {
        if (packet.timeSeconds === open.startSeconds)
          open.birthMaskSequences.push(sequence);
        continue;
      }
      active.delete(context);
      if (
        open.birthMaskSequences.length > 0 &&
        packet.timeSeconds > open.startSeconds
      )
        result.push({
          ...open,
          packetBoundary: { sequence, opcode, timeSeconds: packet.timeSeconds },
        });
    }

    if (opcode !== missileCreate) continue;
    const launch = decodeLaunch(packet.payload, context);
    if (launch === null || !verifiedOwners.has(launch.sourceContext)) continue;
    if (launch.entity !== context)
      throw new Error("The projectile reader returned a foreign actor");
    active.set(context, {
      launch,
      launchSequence: sequence,
      startSeconds: packet.timeSeconds,
      birthMaskSequences: [],
    });
  }
  return result.sort(
    (left, right) => left.launchSequence - right.launchSequence,
  );
}
