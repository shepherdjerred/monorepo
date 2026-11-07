// Successful entries cannot later change: only frozen own-data plain graphs
// qualify. In particular a frozen wrapper around a mutable view does not.
const immutable = new WeakSet();
export function isDirectImmutableData(value) {
  if (value === null || typeof value !== "object")
    return typeof value !== "function" && typeof value !== "symbol";
  if (immutable.has(value)) return true;
  const seen = new WeakSet(),
    entries = [];
  function visit(row) {
    if (row === null || typeof row !== "object")
      return typeof row !== "function" && typeof row !== "symbol";
    if (immutable.has(row) || seen.has(row)) return true;
    const prototype = Object.getPrototypeOf(row);
    if (
      (prototype !== Object.prototype &&
        prototype !== null &&
        !(prototype === Array.prototype && Array.isArray(row))) ||
      !Object.isFrozen(row)
    )
      return false;
    seen.add(row);
    entries.push(row);
    for (const key of Reflect.ownKeys(row)) {
      const descriptor = Object.getOwnPropertyDescriptor(row, key);
      if (!Object.hasOwn(descriptor, "value") || !visit(descriptor.value))
        return false;
    }
    return true;
  }
  if (!visit(value)) return false;
  // Certify only after the entire graph passed, including cyclic ancestors.
  for (const row of entries) immutable.add(row);
  return true;
}

// The caller owns this graph. Unsupported backing stores remain mutable and
// are never certified; freezing is an optimization, not an admission gate.
export function freezeDirectOwnedData(value, protectedObjects = null) {
  const entries = [],
    seen = new WeakSet();
  function visit(row) {
    if (row === null || typeof row !== "object")
      return typeof row !== "function";
    if (protectedObjects?.has(row)) return false;
    if (seen.has(row)) return true;
    const prototype = Object.getPrototypeOf(row);
    if (
      prototype !== Object.prototype &&
      prototype !== null &&
      !(prototype === Array.prototype && Array.isArray(row))
    )
      return false;
    seen.add(row);
    entries.push(row);
    for (const key of Reflect.ownKeys(row)) {
      const descriptor = Object.getOwnPropertyDescriptor(row, key);
      if (!Object.hasOwn(descriptor, "value") || !visit(descriptor.value))
        return false;
    }
    return true;
  }
  if (visit(value)) for (const row of entries) Object.freeze(row);
  return value;
}

// Mark graphs that retain mutable lifecycle ownership. An aliased create input
// must stay uncached rather than freezing or splitting those existing aliases.
export function protectDirectDataGraph(value, objects = new WeakSet()) {
  function visit(row) {
    if (row === null || typeof row !== "object" || objects.has(row)) return;
    objects.add(row);
    if (ArrayBuffer.isView(row) || row instanceof ArrayBuffer) return;
    for (const key of Reflect.ownKeys(row)) {
      const descriptor = Object.getOwnPropertyDescriptor(row, key);
      if (Object.hasOwn(descriptor, "value")) visit(descriptor.value);
    }
  }
  visit(value);
  return objects;
}
