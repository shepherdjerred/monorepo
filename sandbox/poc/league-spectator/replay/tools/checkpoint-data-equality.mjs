// Exact value comparison for the accepted own-data checkpoint graph. Memoize
// completed object pairs so shared immutable metadata is not unfolded repeatedly.
// A pending pair is a cycle, which is outside the checkpoint data contract.
export function sameCheckpointData(left, right) {
  const pairs = new WeakMap();
  const plain = (value) =>
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const bytesEqual = (a, b) =>
    a.length === b.length && a.every((byte, index) => byte === b[index]);
  function same(a, b) {
    if (
      a === null ||
      b === null ||
      typeof a !== "object" ||
      typeof b !== "object"
    )
      return Object.is(a, b);
    let matched = pairs.get(a);
    if (matched?.has(b)) return matched.get(b);
    if (!matched) {
      matched = new WeakMap();
      pairs.set(a, matched);
    }
    matched.set(b, false);
    let equal;
    if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
      equal =
        ArrayBuffer.isView(a) &&
        ArrayBuffer.isView(b) &&
        a.constructor === b.constructor &&
        a.byteLength === b.byteLength &&
        bytesEqual(
          new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
          new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
        );
    } else if (a instanceof ArrayBuffer || b instanceof ArrayBuffer) {
      equal =
        a instanceof ArrayBuffer &&
        b instanceof ArrayBuffer &&
        a.byteLength === b.byteLength &&
        bytesEqual(new Uint8Array(a), new Uint8Array(b));
    } else if (
      Array.isArray(a) !== Array.isArray(b) ||
      (!Array.isArray(a) && (!plain(a) || !plain(b)))
    )
      equal = false;
    else {
      const keys = Reflect.ownKeys(a),
        otherKeys = Reflect.ownKeys(b);
      equal =
        keys.length === otherKeys.length &&
        keys.every((key) => {
          const av = Object.getOwnPropertyDescriptor(a, key),
            bv = Object.getOwnPropertyDescriptor(b, key);
          return (
            typeof key === "string" &&
            av &&
            bv &&
            Object.hasOwn(av, "value") &&
            Object.hasOwn(bv, "value") &&
            same(av.value, bv.value)
          );
        });
    }
    matched.set(b, equal);
    return equal;
  }
  return same(left, right);
}
