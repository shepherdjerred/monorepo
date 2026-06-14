import { describe, expect, test } from "bun:test";
import { drainRing } from "./audio-ring.ts";

const RING = 8; // ring capacity in int16 samples
const BASE = 4; // nonzero byte offset, to prove `base` is respected

// A heap whose ring sample k holds the int16 value 1000 + k (little-endian, as
// wasm linear memory is), so drained PCM is easy to identify by value.
function makeHeap(): Uint8Array {
  const heap = new Uint8Array(BASE + RING * 2 + 4 /* trailing padding */);
  const view = new DataView(heap.buffer);
  for (let k = 0; k < RING; k++) {
    view.setInt16(BASE + k * 2, 1000 + k, true);
  }
  return heap;
}

function decode(pcm: Buffer): number[] {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const out: number[] = [];
  for (let i = 0; i < pcm.byteLength; i += 2) out.push(view.getInt16(i, true));
  return out;
}

describe("drainRing", () => {
  test("returns nothing and keeps the cursor when write === read", () => {
    const { pcm, readPos } = drainRing({
      heap: makeHeap(),
      base: BASE,
      ringSamples: RING,
      readPos: 3,
      writePos: 3,
    });
    expect(pcm.byteLength).toBe(0);
    expect(readPos).toBe(3);
  });

  test("copies the contiguous span when write is ahead of read", () => {
    const { pcm, readPos } = drainRing({
      heap: makeHeap(),
      base: BASE,
      ringSamples: RING,
      readPos: 1,
      writePos: 4,
    });
    expect(decode(pcm)).toEqual([1001, 1002, 1003]);
    expect(readPos).toBe(4);
  });

  test("stitches tail + head across a wraparound", () => {
    const { pcm, readPos } = drainRing({
      heap: makeHeap(),
      base: BASE,
      ringSamples: RING,
      readPos: 6,
      writePos: 2,
    });
    // tail samples 6,7 then head samples 0,1
    expect(decode(pcm)).toEqual([1006, 1007, 1000, 1001]);
    expect(readPos).toBe(2);
  });

  test("drains nearly the whole ring in one read", () => {
    const { pcm, readPos } = drainRing({
      heap: makeHeap(),
      base: BASE,
      ringSamples: RING,
      readPos: 0,
      writePos: 7,
    });
    expect(decode(pcm)).toEqual([1000, 1001, 1002, 1003, 1004, 1005, 1006]);
    expect(readPos).toBe(7);
  });

  test("returns a copy detached from the heap", () => {
    const heap = makeHeap();
    const { pcm } = drainRing({
      heap,
      base: BASE,
      ringSamples: RING,
      readPos: 1,
      writePos: 2,
    });
    // Mutating the heap after draining must not change the returned PCM.
    new DataView(heap.buffer).setInt16(BASE + 1 * 2, 9999, true);
    expect(decode(pcm)).toEqual([1001]);
  });
});
