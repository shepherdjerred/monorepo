// Lossless, type-delimited diagnostic hashing. Metadata numbers retain their
// binary64 bits; typed attributes retain constructor and exact view bytes.
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype),
  typedGet = (key) => Object.getOwnPropertyDescriptor(typedPrototype, key).get,
  typedBuffer = typedGet("buffer"),
  typedOffset = typedGet("byteOffset"),
  typedBytes = typedGet("byteLength"),
  typedLength = typedGet("length"),
  dataGet = (key) =>
    Object.getOwnPropertyDescriptor(DataView.prototype, key).get,
  arrayBufferBytes = Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    "byteLength",
  ).get,
  typedNames = new Map(
    [
      Int8Array,
      Uint8Array,
      Uint8ClampedArray,
      Int16Array,
      Uint16Array,
      Int32Array,
      Uint32Array,
      Float32Array,
      Float64Array,
      BigInt64Array,
      BigUint64Array,
    ].map((type) => [type.prototype, type.name]),
  );
export function directExactValueHash(value, chunkBytes = 65536) {
  const hash = new Bun.CryptoHasher("sha256"),
    slab = new Uint8Array(chunkBytes),
    view = new DataView(slab.buffer),
    encoder = new TextEncoder(),
    strings = new Map();
  let used = 0;
  if (!Number.isInteger(chunkBytes) || chunkBytes < 16)
    throw Error("Bounded exact-hash chunk required");
  const flush = () => {
    if (used) {
      hash.update(slab.subarray(0, used));
      used = 0;
    }
  };
  const room = (n) => {
    if (used + n > slab.length) flush();
  };
  const byte = (n) => {
    room(1);
    slab[used++] = n;
  };
  const size = (n) => {
    if (!Number.isSafeInteger(n) || n < 0)
      throw Error("Exact diagnostic size required");
    do {
      const part = n % 128;
      n = Math.floor(n / 128);
      byte(part | (n ? 128 : 0));
    } while (n);
  };
  const bytes = (b) => {
    if (b.length > slab.length) {
      flush();
      hash.update(b);
      return;
    }
    room(b.length);
    slab.set(b, used);
    used += b.length;
  };
  const text = (s) => {
    let b = strings.get(s);
    if (!b) {
      b = encoder.encode(s);
      if (strings.size < 50000) strings.set(s, b);
    }
    size(b.length);
    bytes(b);
  };
  const ancestors = new WeakSet();
  function write(v) {
    if (v === null) {
      byte(0);
      return;
    }
    if (v === undefined) {
      byte(1);
      return;
    }
    if (typeof v === "boolean") {
      byte(v ? 3 : 2);
      return;
    }
    if (typeof v === "number") {
      byte(4);
      room(8);
      view.setFloat64(used, v, true);
      used += 8;
      return;
    }
    if (typeof v === "string") {
      byte(5);
      text(v);
      return;
    }
    if (typeof v !== "object" || ancestors.has(v))
      throw Error("Acyclic exact diagnostic data required");
    if (ArrayBuffer.isView(v)) {
      const prototype = Object.getPrototypeOf(v),
        data = prototype === DataView.prototype,
        name = data ? "DataView" : typedNames.get(prototype);
      if (
        !name ||
        Reflect.ownKeys(v).length !== (data ? 0 : typedLength.call(v))
      )
        throw Error("Exact intrinsic diagnostic view required");
      const buffer = (data ? dataGet("buffer") : typedBuffer).call(v),
        offset = (data ? dataGet("byteOffset") : typedOffset).call(v),
        length = (data ? dataGet("byteLength") : typedBytes).call(v);
      byte(6);
      text(name);
      size(length);
      bytes(new Uint8Array(buffer, offset, length));
      return;
    }
    if (v instanceof ArrayBuffer) {
      if (
        Object.getPrototypeOf(v) !== ArrayBuffer.prototype ||
        Reflect.ownKeys(v).length
      )
        throw Error("Exact intrinsic diagnostic buffer required");
      byte(7);
      size(arrayBufferBytes.call(v));
      bytes(new Uint8Array(v));
      return;
    }
    ancestors.add(v);
    if (Array.isArray(v)) {
      if (Reflect.ownKeys(v).length !== v.length + 1)
        throw Error("Dense exact diagnostic array required");
      byte(8);
      size(v.length);
      for (let i = 0; i < v.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(v, i);
        if (!descriptor || !Object.hasOwn(descriptor, "value"))
          throw Error("Dense exact diagnostic array required");
        write(descriptor.value);
      }
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(v)))
        throw Error("Plain exact diagnostic object required");
      const keys = Reflect.ownKeys(v);
      if (keys.some((k) => typeof k !== "string"))
        throw Error("String exact diagnostic keys required");
      keys.sort();
      byte(9);
      size(keys.length);
      for (const key of keys) {
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (!Object.hasOwn(d, "value"))
          throw Error("Own exact diagnostic fields required");
        text(key);
        write(d.value);
      }
    }
    ancestors.delete(v);
  }
  write(value);
  flush();
  return hash.digest("hex");
}
