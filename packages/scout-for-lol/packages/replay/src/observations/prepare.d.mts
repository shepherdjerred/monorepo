import type { ReplayDecompressor } from "@scout-for-lol/replay/observations";
import type { PreparedReplayForSeek } from "@scout-for-lol/replay/prepare";

export function prepareReplayForSeek(
  buffer: ArrayBuffer,
  decompress: ReplayDecompressor,
): PreparedReplayForSeek;
