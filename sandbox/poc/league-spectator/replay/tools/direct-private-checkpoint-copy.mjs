import { isDirectImmutableData } from "../latest-direct-immutable-data.mjs";

// Rejected benchmark experiment; the runtime uses structuredClone. Keep this
// isolated so the measured alternative remains reproducible without shipping it.

const typedArrays = new Map(
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
  ].map((Constructor) => [Constructor.prototype, Constructor]),
);

// Automatic checkpoints remain inside this owner. Certified own-data immutable
// graphs can be borrowed; every mutable graph/backing store is copied together
// with one memo, retaining its complete alias topology. Public checkpoint and
// restore boundaries continue to use structuredClone on the complete result.
export function copyDirectPrivateCheckpoint(value) {
  const memo = new Map();
  function copy(source) {
    if (source === null || typeof source !== "object") {
      if (typeof source === "function" || typeof source === "symbol")
        throw Error("Unsupported private checkpoint data value");
      return source;
    }
    if (memo.has(source)) return memo.get(source);
    if (isDirectImmutableData(source)) return source;
    let target;
    if (source instanceof ArrayBuffer) {
      target = source.slice(0);
      memo.set(source, target);
      return target;
    }
    if (ArrayBuffer.isView(source)) {
      const buffer = copy(source.buffer);
      if (Object.getPrototypeOf(source) === DataView.prototype)
        target = new DataView(buffer, source.byteOffset, source.byteLength);
      else {
        const Constructor = typedArrays.get(Object.getPrototypeOf(source));
        if (!Constructor)
          throw Error("Unsupported private checkpoint backing view");
        target = new Constructor(buffer, source.byteOffset, source.length);
      }
      memo.set(source, target);
      return target;
    }
    const prototype = Object.getPrototypeOf(source);
    if (prototype === Map.prototype) {
      target = new Map();
      memo.set(source, target);
      for (const [key, value] of source) target.set(copy(key), copy(value));
      return target;
    }
    if (prototype === Set.prototype) {
      target = new Set();
      memo.set(source, target);
      for (const value of source) target.add(copy(value));
      return target;
    }
    if (prototype === Array.prototype && Array.isArray(source))
      target = new Array(source.length);
    else if (prototype === Object.prototype || prototype === null) target = {};
    else throw Error("Unsupported private checkpoint data object");
    memo.set(source, target);
    for (const key of Object.keys(source)) {
      const value = copy(source[key]);
      if (key === "__proto__")
        Object.defineProperty(target, key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      else target[key] = value;
    }
    return target;
  }
  return copy(value);
}
