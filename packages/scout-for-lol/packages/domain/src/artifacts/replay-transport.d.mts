export type ReplayContainerLayout = Readonly<{
  build: string;
  protocol: string;
  chunkHeaderBytes: 17 | 18;
  compressionTag: number | null;
}>;
export type ReplayTransportLayout = ReplayContainerLayout &
  Readonly<{
    paramDeltaMode: "unsigned8" | "signed8";
    timeDeltaMode: "float64" | "float32";
  }>;

export const REPLAY_TRANSPORT_LAYOUTS: readonly ReplayTransportLayout[];
export const REPLAY_CONTAINER_LAYOUTS: readonly ReplayContainerLayout[];
export const MAX_REPLAY_CHUNK_BYTES: number;
export class ReplayTransportError extends Error {
  readonly code:
    | "unsupported-transport"
    | "unsupported-container"
    | "incompatible-protocol"
    | "invalid-chunk";
  constructor(message: string, code: ReplayTransportError["code"]);
}
export function normalizeGameBuild(value: unknown): string | null;
export function sameGameBuild(left: string, right: string): boolean;
export function getReplayTransportLayout(
  build: string,
  protocol: string,
): ReplayTransportLayout;
export function getReplayContainerLayout(
  build: string,
  protocol: string,
): ReplayContainerLayout;
export function readReplayChunkHeader(
  bytes: Uint8Array,
  layout: ReplayContainerLayout,
): {
  chunkId: number;
  stream: number;
  rawSize: number;
  compressedSize: number;
  storedSize: number;
  compressionTag: number | null;
};
