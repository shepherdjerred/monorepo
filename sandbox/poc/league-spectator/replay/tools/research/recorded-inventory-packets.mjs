import { bindNativeSceneParticipants } from "./native-position-participants.mjs";
import { createCurrentInventoryPacketReader } from "./native-terrain-inventory-packet-reader.mjs";
import { foldRecordedInventory } from "./recorded-inventory-fold.mjs";
import { verifyRecordedInventoryFooter } from "./verify-recorded-inventory-footer.mjs";

const inventoryOpcodes = new Set([190, 226, 248, 415, 797, 840, 1143, 1214]);

/** Observe original timed packet delivery and attest the resulting visible inventory. */
export function createRecordedInventoryCollector(
  replay,
  identity,
  prepared,
  codecs,
) {
  const { participants } = bindNativeSceneParticipants(
    identity,
    prepared.observations,
  );
  const participantIds = participants.map(({ participantId }) => participantId);
  const roster = new Set(participantIds);
  const opening = prepared.packetReader.keyframes[0];
  if (opening?.timeSeconds !== 0)
    throw Error("Replay inventory requires an original time-zero checkpoint.");
  const read = createCurrentInventoryPacketReader(replay, codecs);
  const rows = [];
  let context = 0;
  let opcode;
  return {
    observe(packet) {
      if (packet.blockOffset === 0) {
        context = 0;
        opcode = undefined;
      }
      opcode = packet.explicitOpcode ?? opcode;
      context =
        packet.marker & 32
          ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
          : packet.paramBits;
      const { stream, timeSeconds, chunkOffset } = packet;
      if (
        !inventoryOpcodes.has(opcode) ||
        !roster.has(context) ||
        (stream !== 1 && (stream !== 2 || chunkOffset !== opening.chunkOffset))
      )
        return;
      rows.push({
        context,
        opcode,
        stream,
        timeSeconds,
        chunkOffset,
        ...read(opcode, packet.payload),
      });
    },
    finish() {
      const { tracks } = foldRecordedInventory(rows, {
        participantIds,
        openingChunkOffset: opening.chunkOffset,
        durationSeconds: replay.durationMilliseconds / 1000,
      });
      verifyRecordedInventoryFooter(replay.bytes, participants, tracks);
      return tracks;
    },
  };
}
