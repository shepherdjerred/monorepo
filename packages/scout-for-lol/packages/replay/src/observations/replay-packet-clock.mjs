// Scout-owned primary schedule normalization, without choosing a native clock.
// Each absolute float32 anchor resets the sum of unsigned millisecond deltas.
// Physical envelope order breaks ties, and the secondary field stays raw.
export function* replayTimedPacketEnvelopes(records) {
  const floatBits = new DataView(new ArrayBuffer(4));
  const lastByStream = new Map();
  let chunkOffset = -1;
  let chunkStream;
  let blockOffset = -1;
  let anchorSeconds = 0;
  let elapsedMilliseconds = 0;
  for (const record of records) {
    const { stream, marker, firstTimeBits } = record;
    const compact = Boolean(marker & 128);
    const newChunk = record.chunkOffset !== chunkOffset;
    if (
      !Number.isSafeInteger(record.chunkOffset) ||
      record.chunkOffset < 0 ||
      record.chunkOffset < chunkOffset ||
      !Number.isSafeInteger(record.blockOffset) ||
      (newChunk
        ? record.blockOffset !== 0 || compact
        : record.blockOffset <= blockOffset || stream !== chunkStream)
    )
      throw Error("Invalid timed packet chunk order or initial anchor");
    chunkOffset = record.chunkOffset;
    chunkStream = stream;
    blockOffset = record.blockOffset;
    if (
      !Number.isInteger(firstTimeBits) ||
      firstTimeBits < 0 ||
      firstTimeBits > (compact ? 255 : 0xffffffff)
    )
      throw Error("Invalid primary packet clock bits");
    if (compact) {
      elapsedMilliseconds += firstTimeBits;
    } else {
      floatBits.setUint32(0, firstTimeBits, true);
      anchorSeconds = floatBits.getFloat32(0, true);
      elapsedMilliseconds = 0;
    }
    const timeSeconds = anchorSeconds + elapsedMilliseconds / 1000;
    if (
      !Number.isFinite(timeSeconds) ||
      timeSeconds < 0 ||
      timeSeconds < (lastByStream.get(stream) ?? 0)
    )
      throw Error(`Invalid primary packet clock order in stream ${stream}`);
    lastByStream.set(stream, timeSeconds);
    yield { ...record, timeSeconds };
  }
}
