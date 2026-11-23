import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { replayPacketEnvelopes } from "../../transport.mjs";

export function* recordedAnimationRequests(replay, decompress, actors) {
  let context = 0;
  let opcode = null;
  for (const packet of replayTimedPacketEnvelopes(
    replayPacketEnvelopes(replay, decompress),
  )) {
    if (packet.blockOffset === 0) {
      context = 0;
      opcode = null;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (packet.stream === 1 && opcode === 669 && actors.has(context))
      yield { context, ...packet };
  }
}

export function supportsRecordedAnimationRequest(
  flags,
  adjustmentBits,
  overrideBits,
) {
  return (
    (flags === 0 || flags === 16) &&
    adjustmentBits === "00000000" &&
    overrideBits === "00000000"
  );
}
