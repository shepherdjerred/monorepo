// Fetch arrayBuffer() and binary asset loaders have two explicit input shapes.
// Normalize once into owned bytes before strict content-pinned factories run.
export function ownLatestStaticBytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw Error("Static asset input must be ArrayBuffer or Uint8Array");
}
