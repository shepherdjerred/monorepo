import {
  openReplayPacketSource,
  bindReplayPacketReader,
} from "./packet-reader.mjs";
import { createReplayKeyframeIndexObserver } from "./replay-keyframe-index.mjs";
import { decodeParsedReplayObservations } from "./decode.mjs";
import { createTurretSnapshotCollector } from "./replay-turret-state.mjs";

/** One original envelope traversal; observers retain scalar evidence, not packet history. */
export function prepareReplayForSeek(buffer, decompress) {
  const { replay, byteLength } = openReplayPacketSource(buffer, decompress);
  const indexObserver = createReplayKeyframeIndexObserver(replay);
  const turretObserver = createTurretSnapshotCollector();
  let observations;
  try {
    observations = decodeParsedReplayObservations(replay, decompress, {
      observeRawPacket(packet) {
        indexObserver.observeRawPacket(packet);
        turretObserver.observeRawPacket(packet);
      },
    });
  } catch (cause) {
    if (buffer.byteLength !== byteLength)
      throw Error("The original replay buffer was detached or resized", {
        cause,
      });
    throw cause;
  }
  const index = indexObserver.finish();
  const packetReader = bindReplayPacketReader(
    replay,
    index,
    decompress,
    byteLength,
  );
  const readTurretState = turretObserver.finish(packetReader, observations);
  return Object.freeze({ packetReader, observations, readTurretState });
}
