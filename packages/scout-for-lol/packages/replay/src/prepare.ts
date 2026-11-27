import { prepareReplayForSeek as prepare } from "./observations/prepare.mjs";
import type { ReplayDecompressor, ReplayObservations } from "./observations.ts";
import type { ReplayPacketReader } from "./packets.ts";
import type { ReadReplayTurretState } from "./observations/replay-turret-state.mjs";

export type PreparedReplayForSeek = Readonly<{
  packetReader: ReplayPacketReader;
  observations: ReplayObservations;
  readTurretState: ReadReplayTurretState;
}>;

/** Build same-file observations and seek index without decompressing the replay twice. */
export function prepareReplayForSeek(
  buffer: ArrayBuffer,
  decompress: ReplayDecompressor,
  options?: Readonly<{ allowCurrentBuild?: boolean }>,
): PreparedReplayForSeek {
  return prepare(buffer, decompress, options);
}
