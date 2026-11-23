// Shared browser/server transport admission. A new patch requires observations
// of its real container; matching a four-part version never implies a layout.
// 16.14: KR_8305643709; 16.21: NA1-5667809143 (including an uncompressed
// stream-4 chunk with the same 0x04 trailing tag as compressed chunks).
export const REPLAY_TRANSPORT_LAYOUTS = Object.freeze([
  Object.freeze({
    build: "16.14.794.5912",
    protocol: "509c49fd988fca11",
    chunkHeaderBytes: 17,
    compressionTag: null,
    paramDeltaMode: "unsigned8",
    timeDeltaMode: "float64",
  }),
  Object.freeze({
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    chunkHeaderBytes: 18,
    compressionTag: 4,
    paramDeltaMode: "signed8",
    timeDeltaMode: "float32",
  }),
]);

export const MAX_REPLAY_CHUNK_BYTES = 64 * 1024 * 1024;

// Outer-container observations only. Every row was read from a complete local
// replay with bounded chunks and an exact metadata-declared chunk count. These
// observations admit authenticated storage, never packet semantics or playback.
export const REPLAY_CONTAINER_LAYOUTS = Object.freeze([
  ...REPLAY_TRANSPORT_LAYOUTS,
  // Verified across all 83 chunks of a local 16.23 ARAM Mayhem container.
  Object.freeze({
    build: "16.23.839.9929",
    protocol: "8bbfcd5af2bc92db",
    chunkHeaderBytes: 18,
    compressionTag: 4,
  }),
  // Verified across all seven chunks of a local replay from this build.
  Object.freeze({
    build: "16.23.840.6595",
    protocol: "8bbfcd5af2bc92db",
    chunkHeaderBytes: 18,
    compressionTag: 4,
  }),
  ...[
    ["15.24.734.7485", "61eece772542bd96"], // NA1-5455036925
    ["16.1.737.4870", "f884daa8c6569569"], // NA1-5464063815
    ["16.10.776.5552", "cc1dc87749c208bd"], // NA1-5565990955
    ["16.14.794.9266", "509c49fd988fca11"], // NA1-5609625945
    ["16.16.804.9184", "532e3e790c8816fd"], // NA1-5624898983
    ["16.17.810.4348", "3714cb24566263e2"], // NA1-5637901467
    ["16.18.817.5716", "f6a10af08504a7ee"], // NA1-5645423903
    ["16.19.820.7193", "6bfab33e871a4a58"], // NA1-5647649227
    ["16.19.823.722", "6bfab33e871a4a58"], // NA1-5653878032 (0722)
    ["16.20.824.8524", "142cabd45e45d83f"], // NA1-5656067359
  ].map(([build, protocol]) =>
    Object.freeze({
      build,
      protocol,
      chunkHeaderBytes: 17,
      compressionTag: null,
    }),
  ),
]);

export class ReplayTransportError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ReplayTransportError";
    this.code = code;
  }
}

export function normalizeGameBuild(value) {
  if (
    typeof value !== "string" ||
    !/^\d{1,2}\.\d{1,2}\.\d{1,8}\.\d{1,8}$/.test(value)
  )
    return null;
  return value.split(".").map(Number).join(".");
}

export function sameGameBuild(left, right) {
  const normalized = normalizeGameBuild(left);
  return normalized !== null && normalized === normalizeGameBuild(right);
}

export function getReplayTransportLayout(build, protocol) {
  const normalized = normalizeGameBuild(build);
  const layout = REPLAY_TRANSPORT_LAYOUTS.find(
    (candidate) =>
      candidate.build === normalized && candidate.protocol === protocol,
  );
  if (!layout)
    throw new ReplayTransportError(
      `Unsupported transport build/protocol: ${build} / ${protocol}`,
      "unsupported-transport",
    );
  return layout;
}

export function getReplayContainerLayout(build, protocol) {
  const normalized = normalizeGameBuild(build);
  const layout = REPLAY_CONTAINER_LAYOUTS.find(
    (candidate) =>
      candidate.build === normalized && candidate.protocol === protocol,
  );
  if (
    !layout &&
    REPLAY_CONTAINER_LAYOUTS.some((candidate) => candidate.build === normalized)
  )
    throw new ReplayTransportError(
      `Unsupported container protocol for admitted build: ${build} / ${protocol}`,
      "incompatible-protocol",
    );
  if (!layout)
    throw new ReplayTransportError(
      `Unsupported container build/protocol: ${build} / ${protocol}; transport admission is preparing`,
      "unsupported-container",
    );
  return layout;
}

export function readReplayChunkHeader(bytes, layout) {
  if (!REPLAY_CONTAINER_LAYOUTS.includes(layout))
    throw new ReplayTransportError(
      "An admitted transport layout is required",
      "unsupported-transport",
    );
  if (!(bytes instanceof Uint8Array) || bytes.length < layout.chunkHeaderBytes)
    throw new ReplayTransportError("Truncated chunk header", "invalid-chunk");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const streamTag = view.getUint32(5, true);
  const stream = streamTag >>> 24;
  const rawSize = view.getUint32(9, true);
  const compressedSize = view.getUint32(13, true);
  const storedSize = compressedSize || rawSize;
  const compressionTag = layout.chunkHeaderBytes === 18 ? bytes[17] : null;
  if (compressionTag !== layout.compressionTag)
    throw new ReplayTransportError(
      `Unsupported chunk compression tag ${compressionTag}`,
      "invalid-chunk",
    );
  if (
    (streamTag & 0x00ffffff) !== 0 ||
    stream < 1 ||
    stream > 4 ||
    rawSize === 0 ||
    rawSize > MAX_REPLAY_CHUNK_BYTES ||
    storedSize > MAX_REPLAY_CHUNK_BYTES
  )
    throw new ReplayTransportError("Invalid chunk header", "invalid-chunk");
  return {
    chunkId: view.getUint32(0, true),
    stream,
    rawSize,
    compressedSize,
    storedSize,
    compressionTag,
  };
}
