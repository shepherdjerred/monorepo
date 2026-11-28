import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { replayPacketEnvelopes } from "../../transport.mjs";
import {
  currentTerrainPositionBuild,
  recoverTerrainByteSubstitution,
  rotateByteLeft,
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

/** Decode the opcode 1164 body after the envelope supplies its context. */
export function createRecordedRiftStopReader(replay, codecs) {
  assertRecordedRiftEffectBuild(replay);
  const table = recoverTerrainByteSubstitution(codecs);
  const decodeByte = (byte) => rotateByteLeft((table[byte] + 0x7f) & 255, 2);
  return (payload) => {
    if (payload.length < 1 || payload.length > 6) return null;
    const header = payload[0];
    const flags = (header & 8) === 0 ? 52 : 60;
    const route = (flags & 8) === 0 ? "direct-stop" : "alternate-stop";
    switch (header & 7) {
      case 1:
        return payload.length === 1
          ? { target: 0xffff_ffff, flags, route }
          : null;
      case 2:
        return payload.length === 1 ? { target: 0, flags, route } : null;
    }
    let target = 0;
    for (let index = 1; index < payload.length; index++) {
      const byte = decodeByte(payload[index]);
      if (index === 5 && byte > 15) return null;
      target |= (byte & 127) << ((index - 1) * 7);
      if ((byte & 128) === 0) {
        if (index !== payload.length - 1) return null;
        // The native store and lookup byte transforms cancel. The actor tag
        // toggles only when the decoded target has a nonzero low 24-bit ID.
        if ((target & 0xff_ffff) !== 0) target ^= 0x4000_0000;
        return { target: target >>> 0, flags, route };
      }
    }
    return null;
  };
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
