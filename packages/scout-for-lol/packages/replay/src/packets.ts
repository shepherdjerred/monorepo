import { createReplayPacketReader as createReader } from "./observations/packet-reader.mjs";
import { openReplay } from "./observations/transport.mjs";
import type { ReplayDecompressor } from "./observations.ts";

export type ReplayPacketKeyframe = Readonly<{
  chunkId: number;
  chunkOffset: number;
  storedChunkBytes: number;
  timeSeconds: number;
  secondTimeBits: number;
  predecessorChunkId: number;
  predecessorStream: number;
}>;
export type ReplayRawPacket = {
  chunkId: number;
  chunkOffset: number;
  storedChunkBytes: number;
  stream: number;
  blockOffset: number;
  marker: number;
  firstTimeBits: number;
  secondTimeBits: number;
  explicitOpcode: number | null;
  paramBits: number;
  timeSeconds: number;
  /** Borrowed payload bytes; callers must not modify these views. */
  payload: Uint8Array;
};
export type ReplayPacketWindow = {
  keyframe: ReplayPacketKeyframe;
  packets: Generator<ReplayRawPacket, void, unknown>;
};
export type ReplayPacketReader = Readonly<{
  build: string;
  protocol: string;
  durationSeconds: number;
  durationMilliseconds: number;
  keyframes: readonly ReplayPacketKeyframe[];
  read: (
    timeSeconds: number,
    options?: { signal?: AbortSignal },
  ) => ReplayPacketWindow;
}>;

/** Read the original container header and footer without decoding packet bodies. */
export function readReplayContainerIdentity(buffer: ArrayBuffer): Pick<
  ReplayPacketReader,
  "build" | "protocol" | "durationMilliseconds"
> & {
  participantCount: number;
} {
  const { build, protocol, durationMilliseconds, roster } = openReplay(buffer);
  return {
    build,
    protocol,
    durationMilliseconds,
    participantCount: roster.length,
  };
}

/** Read-only original-buffer ownership; cancellation is checked between packet reads. */
export function createReplayPacketReader(
  buffer: ArrayBuffer,
  decompress: ReplayDecompressor,
): ReplayPacketReader {
  return createReader(buffer, decompress);
}
