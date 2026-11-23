import type { ReplayDecompressor } from "@scout-for-lol/replay/observations";
import type { ReplayPacketReader } from "@scout-for-lol/replay/packets";

export function createReplayPacketReader(
  buffer: ArrayBuffer,
  decompress: ReplayDecompressor,
): ReplayPacketReader;
