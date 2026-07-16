// Read-only typed access to the wasm linear memory. The memory is fixed-size
// (it never grows), so the cached views stay valid for the process lifetime —
// the same invariant the renderer and BIOS rely on.

export type MemoryReader = {
  u8: (addr: number) => number;
  u16: (addr: number) => number;
  s16: (addr: number) => number;
  u32: (addr: number) => number;
  /** Copy `len` bytes starting at `addr`. Never returns a live view. */
  bytes: (addr: number, len: number) => Uint8Array;
  readonly byteLength: number;
};

export function createMemoryReader(memory: WebAssembly.Memory): MemoryReader {
  const view = new DataView(memory.buffer);
  const u8 = new Uint8Array(memory.buffer);
  const byteLength = memory.buffer.byteLength;

  function check(addr: number, size: number): void {
    if (!Number.isInteger(addr) || addr < 0 || addr + size > byteLength) {
      throw new RangeError(
        `memory read out of bounds: ${String(addr)} (+${String(size)})`,
      );
    }
  }

  return {
    u8(addr: number): number {
      check(addr, 1);
      return view.getUint8(addr);
    },
    u16(addr: number): number {
      check(addr, 2);
      return view.getUint16(addr, true);
    },
    s16(addr: number): number {
      check(addr, 2);
      return view.getInt16(addr, true);
    },
    u32(addr: number): number {
      check(addr, 4);
      return view.getUint32(addr, true);
    },
    bytes(addr: number, len: number): Uint8Array {
      check(addr, len);
      return u8.slice(addr, addr + len);
    },
    byteLength,
  };
}
