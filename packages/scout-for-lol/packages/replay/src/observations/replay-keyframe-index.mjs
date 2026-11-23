// Scout-owned exact-build index; research imports retain compatibility.
import { replayPacketEnvelopes } from "./transport.mjs";

const boundaryOpcode = 1167;

function requireBoundary(record) {
  if (record.explicitOpcode !== boundaryOpcode || record.payload.length !== 2)
    throw Error(
      `Invalid keyframe boundary in chunk ${record.chunkId}, stream ${record.stream}`,
    );
}

/** Locate exact recorded keyframe byte ranges for the admitted 16.23 envelopes. */
export function createReplayKeyframeIndexObserver(replay) {
  const index = [];
  const clock = new DataView(new ArrayBuffer(4));
  let lastSecondaryTime = -Infinity;
  let seenInitial = false;
  let current = null;
  let finished = false;
  return {
    observeRawPacket(record) {
      if (finished)
        throw Error("Keyframe index observation is already complete");
      const { stream, chunkId, chunkOffset, storedChunkBytes, secondTimeBits } =
        record;
      const previous = current;
      const newChunk = previous?.chunkOffset !== chunkOffset;
      if (newChunk && previous?.stream === 1) requireBoundary(previous);
      current = record;

      if (stream === 4) {
        if (seenInitial || index.length)
          throw Error("Expected one initial keyframe boundary record");
        requireBoundary(record);
        seenInitial = true;
      }
      if (stream !== 2 || !newChunk) return;

      requireBoundary(record);
      const predecessorStream = index.length === 0 ? 4 : 1;
      // The previous physical chunk's terminal record shares the secondary clock
      // bits and second payload byte with the keyframe's first record.
      if (
        previous?.stream !== predecessorStream ||
        previous.secondTimeBits !== secondTimeBits ||
        previous.payload[1] !== record.payload[1]
      )
        throw Error(
          `Missing adjacent predecessor for keyframe chunk ${chunkId}`,
        );
      clock.setUint32(0, secondTimeBits, true);
      const secondaryTime = clock.getFloat32(0, true);
      if (
        !Number.isFinite(secondaryTime) ||
        secondaryTime < 0 ||
        secondaryTime <= lastSecondaryTime
      )
        throw Error(
          `Invalid secondary clock order for keyframe chunk ${chunkId}`,
        );
      lastSecondaryTime = secondaryTime;
      if (record.marker & 128)
        throw Error(
          `Expected absolute primary clock for keyframe chunk ${chunkId}`,
        );
      clock.setUint32(0, record.firstTimeBits, true);
      const timeSeconds = clock.getFloat32(0, true);
      if (
        !Number.isFinite(timeSeconds) ||
        timeSeconds < 0 ||
        timeSeconds > replay.duration ||
        (index.length === 0
          ? !Object.is(timeSeconds, 0)
          : timeSeconds <= index.at(-1).timeSeconds)
      )
        throw Error(`Invalid primary clock for keyframe chunk ${chunkId}`);
      index.push({
        chunkId,
        chunkOffset,
        storedChunkBytes,
        timeSeconds,
        secondTimeBits,
        predecessorChunkId: previous.chunkId,
        predecessorStream,
      });
    },
    finish() {
      if (finished)
        throw Error("Keyframe index observation is already complete");
      if (current?.stream === 1) requireBoundary(current);
      if (!index.length) throw Error("Replay has no paired keyframes");
      finished = true;
      current = null;
      return index;
    },
  };
}

export function buildReplayKeyframeIndex(replay, decompress) {
  const observer = createReplayKeyframeIndexObserver(replay);
  for (const record of replayPacketEnvelopes(replay, decompress))
    observer.observeRawPacket(record);
  return observer.finish();
}

/** Find the latest indexed keyframe at or before the requested recorded time. */
export function findReplayKeyframe(index, timeSeconds) {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0)
    throw Error("Invalid replay keyframe lookup time");
  let low = 0;
  let high = index.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (index[middle].timeSeconds <= timeSeconds) low = middle + 1;
    else high = middle;
  }
  return low === 0 ? null : index[low - 1];
}
