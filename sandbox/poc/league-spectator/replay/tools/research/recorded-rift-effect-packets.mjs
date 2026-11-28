import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { replayPacketEnvelopes } from "../../transport.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

const effectPackets = new Map([
  [938, "create"],
  [1164, "stop"],
]);

export function assertRecordedRiftEffectBuild({ build, protocol }) {
  if (
    build !== currentTerrainPositionBuild ||
    protocol !== terrainPositionProtocol
  )
    throw Error("Recorded particle packet build or protocol differs");
}

export function readRecordedRiftEffectPackets(replay, decompress) {
  assertRecordedRiftEffectBuild(replay);
  return selectRecordedRiftEffectPackets(
    replayTimedPacketEnvelopes(replayPacketEnvelopes(replay, decompress)),
  );
}

// Sequence includes filtered streams and opcodes. Receipts use that physical
// ordinal to join native semantics to bytes, including same-clock packets.
export function* selectRecordedRiftEffectPackets(envelopes) {
  let opcode;
  let context = 0;
  let sequence = 0;
  for (const envelope of envelopes) {
    const ordinal = sequence++;
    if (envelope.blockOffset === 0) {
      opcode = undefined;
      context = 0;
    }
    opcode = envelope.explicitOpcode ?? opcode;
    context =
      envelope.marker & 32
        ? (context + ((envelope.paramBits << 24) >> 24)) >>> 0
        : envelope.paramBits;
    const kind = effectPackets.get(opcode);
    if (envelope.stream === 1 && kind !== undefined)
      yield {
        kind,
        opcode,
        sequence: ordinal,
        context,
        timeSeconds: envelope.timeSeconds,
        payload: envelope.payload,
      };
  }
}
