// Typed, refreshable views over the wasm linear memory + read/write helpers at
// byte offsets. Mirrors the pattern used by `bios.ts` (one shared memory view
// the engine touches; reset after instantiation via `refresh()`).
//
// All accessors take (base, offset) — `base` is the linear-memory pointer of
// the containing struct, `offset` is the field's byte offset from the constants
// in `m4a-structs.ts`. This keeps call sites readable: `mem.u8(MPT_ptr, MPT.vol)`.

export type M4aMemory = {
  refresh: (memory: WebAssembly.Memory) => void;
  u8: (ptr: number, offset: number) => number;
  s8: (ptr: number, offset: number) => number;
  u16: (ptr: number, offset: number) => number;
  s16: (ptr: number, offset: number) => number;
  u32: (ptr: number, offset: number) => number;
  s32: (ptr: number, offset: number) => number;
  writeU8: (ptr: number, offset: number, value: number) => void;
  writeS8: (ptr: number, offset: number, value: number) => void;
  writeU16: (ptr: number, offset: number, value: number) => void;
  writeU32: (ptr: number, offset: number, value: number) => void;
  writeS32: (ptr: number, offset: number, value: number) => void;
  /** Copy `len` bytes starting at `(ptr + offset)` into a fresh Uint8Array. */
  slice: (ptr: number, offset: number, len: number) => Uint8Array;
  /** Direct view into wasm memory; valid until the next `refresh()`. */
  rawU8: () => Uint8Array;
};

export function createM4aMemory(): M4aMemory {
  let u8 = new Uint8Array(0);
  let dv = new DataView(new ArrayBuffer(0));

  function refresh(memory: WebAssembly.Memory): void {
    u8 = new Uint8Array(memory.buffer);
    dv = new DataView(memory.buffer);
  }

  return {
    refresh,
    u8: (ptr, off) => u8[ptr + off],
    s8: (ptr, off) => dv.getInt8(ptr + off),
    u16: (ptr, off) => dv.getUint16(ptr + off, true),
    s16: (ptr, off) => dv.getInt16(ptr + off, true),
    u32: (ptr, off) => dv.getUint32(ptr + off, true),
    s32: (ptr, off) => dv.getInt32(ptr + off, true),
    writeU8: (ptr, off, v) => {
      u8[ptr + off] = v & 0xff;
    },
    writeS8: (ptr, off, v) => {
      // DataView.setInt8 already coerces via signed 8-bit truncation; pass v
      // directly rather than pre-normalizing with ((v + 128) & 0xff) - 128,
      // which produces the same bit pattern but obscures the intent.
      dv.setInt8(ptr + off, v);
    },
    writeU16: (ptr, off, v) => {
      dv.setUint16(ptr + off, v & 0xff_ff, true);
    },
    writeU32: (ptr, off, v) => {
      dv.setUint32(ptr + off, v >>> 0, true);
    },
    writeS32: (ptr, off, v) => {
      dv.setInt32(ptr + off, Math.trunc(v), true);
    },
    slice: (ptr, off, len) => u8.slice(ptr + off, ptr + off + len),
    rawU8: () => u8,
  };
}
