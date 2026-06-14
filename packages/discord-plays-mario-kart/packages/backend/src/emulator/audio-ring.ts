// Pure ring-buffer drain math for the emscripten resampled audio buffer.
//
// The core writes interleaved s16le stereo samples into a fixed-size int16 ring
// (`resampled_out_buf` in audio_backend_libretro.c) and advances a write cursor
// measured in int16 samples, wrapping at the ring's capacity. The host keeps a
// read cursor and, each tick, copies everything written since the last drain.
//
// Bytes are copied out of wasm linear memory verbatim: wasm is little-endian, so
// the in-memory bytes are already s16le and need no conversion. Buffer.from /
// Buffer.concat copy, detaching the result from the (reused) heap view.

export type DrainRingArgs = {
  /** Wasm linear memory (HEAPU8). */
  readonly heap: Uint8Array;
  /** Byte offset of the ring's start within `heap`. */
  readonly base: number;
  /** Ring capacity in int16 samples. */
  readonly ringSamples: number;
  /** Last-drained position (int16 sample index, in [0, ringSamples)). */
  readonly readPos: number;
  /** Core's current write position (int16 sample index, in [0, ringSamples)). */
  readonly writePos: number;
};

export type DrainRingResult = {
  /** Newly written PCM (s16le), or an empty buffer when nothing is pending. */
  readonly pcm: Buffer;
  /** Advanced read cursor to persist for the next drain. */
  readonly readPos: number;
};

/**
 * Copy the samples written between `readPos` and `writePos`, handling the single
 * wraparound the ring can present between two drains. Returns the PCM plus the
 * new read cursor (which equals `writePos`).
 */
export function drainRing(args: DrainRingArgs): DrainRingResult {
  const { heap, base, ringSamples, readPos, writePos } = args;
  if (writePos === readPos) {
    return { pcm: Buffer.alloc(0), readPos };
  }
  const ringEndByte = base + ringSamples * 2;
  const readByte = base + readPos * 2;
  const writeByte = base + writePos * 2;
  const pcm =
    writePos > readPos
      ? Buffer.from(heap.subarray(readByte, writeByte))
      : // wrapped: [read, end) followed by [start, write)
        Buffer.concat([
          heap.subarray(readByte, ringEndByte),
          heap.subarray(base, writeByte),
        ]);
  return { pcm, readPos: writePos };
}
