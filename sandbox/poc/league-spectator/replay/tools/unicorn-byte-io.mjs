// Prototype for the already-pinned Unicorn runtime ABI. Guest memory APIs and
// their error codes are unchanged; only host scratch packing uses 32-bit lanes
// instead of allocating and visiting each byte through the JS vendor wrapper.
export function createUnicornByteIo(uc, engine) {
  for (const name of [
    "_malloc",
    "_free",
    "_uc_mem_read",
    "_uc_mem_write",
    "getValue",
    "setValue",
  ])
    if (typeof uc[name] !== "function")
      throw Error("Pinned Unicorn memory ABI required");
  const handle = uc.getValue(engine.handle_ptr, "*");
  let pointer = 0,
    capacity = 0,
    closed = false;
  function allocate(size) {
    const result = uc._malloc(size);
    if (!Number.isSafeInteger(result) || result <= 0)
      throw Error("Unicorn scratch allocation failed");
    return result;
  }
  function scratch(size, use) {
    if (closed) throw Error("Unicorn byte IO is closed");
    if (!Number.isSafeInteger(size) || size < 0 || size > 0x7fffffff)
      throw Error("Bounded Unicorn byte length required");
    if (size > 0x200000) {
      const temporary = allocate(size);
      try {
        return use(temporary);
      } finally {
        uc._free(temporary);
      }
    }
    if (size > capacity || pointer === 0) {
      const nextCapacity = Math.max(64, size + ((16 - (size % 16)) % 16));
      const next = allocate(nextCapacity);
      if (pointer) uc._free(pointer);
      pointer = next;
      capacity = nextCapacity;
    }
    return use(pointer);
  }
  function checked(code, operation) {
    if (code !== uc.ERR_OK) {
      const error = Error(
        `Unicorn memory ${operation} failed with code ${code}`,
      );
      error.code = code;
      throw error;
    }
  }
  function readInto(address, size, at) {
    checked(
      uc._uc_mem_read(handle, BigInt(address || 0), at, BigInt(size || 0)),
      "read",
    );
  }
  function writeFrom(address, size, at) {
    checked(
      uc._uc_mem_write(handle, BigInt(address || 0), at, BigInt(size || 0)),
      "write",
    );
  }
  return Object.freeze({
    read(address, size) {
      return scratch(size, (at) => {
        readInto(address, size, at);
        const bytes = new Uint8Array(size),
          view = new DataView(bytes.buffer);
        let offset = 0;
        for (; offset + 4 <= size; offset += 4)
          view.setInt32(offset, uc.getValue(at + offset, "i32"), true);
        for (; offset < size; offset++)
          bytes[offset] = uc.getValue(at + offset, "i8");
        return bytes;
      });
    },
    write(address, bytes) {
      if (!(bytes instanceof Uint8Array))
        throw Error("Owned Uint8Array memory write required");
      return scratch(bytes.length, (at) => {
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        let offset = 0;
        for (; offset + 4 <= bytes.length; offset += 4)
          uc.setValue(at + offset, view.getInt32(offset, true), "i32");
        for (; offset < bytes.length; offset++)
          uc.setValue(at + offset, bytes[offset], "i8");
        writeFrom(address, bytes.length, at);
      });
    },
    readU32(address) {
      return scratch(4, (at) => {
        readInto(address, 4, at);
        return uc.getValue(at, "i32") >>> 0;
      });
    },
    writeU64(address, value) {
      return scratch(8, (at) => {
        uc.setValue(at, BigInt.asIntN(64, BigInt(value)), "i64");
        writeFrom(address, 8, at);
      });
    },
    close() {
      if (closed) return;
      closed = true;
      if (pointer) uc._free(pointer);
      pointer = 0;
      capacity = 0;
    },
  });
}
