import { openReplay } from "./transport.mjs";
import { buildReplayKeyframeIndex } from "./replay-keyframe-index.mjs";
import { readReplaySeekWindow } from "./replay-seek-window.mjs";

function requireOriginalBuffer(replay, byteLength) {
  if (replay.bytes.byteLength !== byteLength)
    throw Error("The original replay buffer was detached or resized");
}

function readWindow(
  replay,
  index,
  decompress,
  byteLength,
  timeSeconds,
  signal,
) {
  signal?.throwIfAborted();
  requireOriginalBuffer(replay, byteLength);
  const window = readReplaySeekWindow(replay, index, timeSeconds, decompress);
  function* packets() {
    try {
      for (;;) {
        signal?.throwIfAborted();
        requireOriginalBuffer(replay, byteLength);
        const next = window.packets.next();
        if (next.done) return;
        signal?.throwIfAborted();
        requireOriginalBuffer(replay, byteLength);
        yield next.value;
      }
    } finally {
      window.packets.return();
    }
  }
  return {
    keyframe: Object.freeze({ ...window.keyframe }),
    packets: packets(),
  };
}

/** Borrows unchanged original bytes. No fetch, worker, copied ROFL or rendering state. */
export function openReplayPacketSource(buffer, decompress) {
  if (
    !(buffer instanceof ArrayBuffer) ||
    !buffer.byteLength ||
    typeof decompress !== "function"
  )
    throw Error(
      "Original replay ArrayBuffer and compatible decompressor required",
    );
  const replay = openReplay(buffer);
  if (
    !Number.isSafeInteger(replay.durationMilliseconds) ||
    replay.durationMilliseconds <= 0
  )
    throw Error("Validated integer-millisecond replay duration required");
  const byteLength = buffer.byteLength;
  return { replay, byteLength };
}

/** Internal binder: the supplied index is completed by this source's observer. */
export function bindReplayPacketReader(replay, index, decompress, byteLength) {
  requireOriginalBuffer(replay, byteLength);
  return Object.freeze({
    build: replay.build,
    protocol: replay.protocol,
    durationSeconds: replay.durationMilliseconds / 1000,
    durationMilliseconds: replay.durationMilliseconds,
    keyframes: Object.freeze(index.map((entry) => Object.freeze({ ...entry }))),
    read(timeSeconds, { signal } = {}) {
      return readWindow(
        replay,
        index,
        decompress,
        byteLength,
        timeSeconds,
        signal,
      );
    },
  });
}

export function createReplayPacketReader(buffer, decompress) {
  const { replay, byteLength } = openReplayPacketSource(buffer, decompress);
  const index = buildReplayKeyframeIndex(replay, decompress);
  return bindReplayPacketReader(replay, index, decompress, byteLength);
}
