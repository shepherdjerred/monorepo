import { join } from "node:path";
import { createRmanChunkReader } from "./rman-chunks.mjs";

const hex = (value) =>
  BigInt(value).toString(16).toUpperCase().padStart(16, "0");
const key = (chunk) =>
  `${hex(chunk.id)}-${hex(chunk.bundleId)}-${chunk.offset}-${chunk.compressedSize}-${chunk.uncompressedSize}`;

// Opt-in for complete files: one opaque chunk ID can occur at several genuine
// locations in the same RMAN. Existing default receipts are never rewritten.
export async function createLocationScopedRmanChunkReader(
  manifest,
  cacheRoot,
  decompress,
) {
  if (
    !/^[a-f0-9]{64}$/.test(manifest.sourceSha256 ?? "") ||
    !Array.isArray(manifest.bundles)
  )
    throw Error(
      "Location-scoped chunks require a hashed complete source manifest",
    );
  const bundles = new Map();
  for (const bundle of manifest.bundles) {
    const id = hex(bundle.id);
    if (bundles.has(id)) throw Error("Duplicate source RMAN bundle identity");
    bundles.set(id, bundle.chunks);
  }
  function admitted(chunk) {
    const rows = bundles.get(hex(chunk.bundleId));
    if (!rows) return false;
    let lower = 0,
      upper = rows.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (rows[middle].offset < chunk.offset) lower = middle + 1;
      else upper = middle;
    }
    const row = rows[lower];
    return row !== undefined && key(row) === key(chunk);
  }
  const legacy = await createRmanChunkReader(manifest, cacheRoot, decompress),
    scoped = new Map(),
    pending = new Map();
  async function scopedRead(chunk) {
    const location = key(chunk);
    let reader = scoped.get(location);
    if (!reader) {
      reader = await createRmanChunkReader(
        manifest,
        join(cacheRoot, "source-locations", location),
        decompress,
      );
      scoped.set(location, reader);
    }
    return reader(chunk);
  }
  async function load(chunk) {
    if (!admitted(chunk))
      throw Error("RMAN chunk location absent from exact source manifest");
    const id = hex(chunk.id),
      receiptFile = Bun.file(
        join(cacheRoot, "chunks", manifest.manifestId, `${id}.json`),
      );
    if (!(await receiptFile.exists())) return scopedRead(chunk);
    const receipt = await receiptFile.json();
    if (!/^[A-F0-9]{16}$/.test(receipt.bundleId ?? ""))
      throw Error(`Invalid RMAN legacy receipt bundle ${id}`);
    const old = {
      id: chunk.id,
      bundleId: BigInt(`0x${receipt.bundleId}`),
      offset: receipt.rangeStart,
      compressedSize: receipt.compressedBytes,
      uncompressedSize: receipt.uncompressedBytes,
    };
    // Validate the old receipt through its unchanged reader, even for a different
    // admitted location. Corrupt bytes/source identities never trigger a fetch.
    if (
      receipt.schemaVersion !== 1 ||
      receipt.manifestId !== manifest.manifestId ||
      receipt.sourceManifestSha256 !== manifest.sourceSha256 ||
      receipt.chunkId !== id ||
      !/^[A-F0-9]{16}$/.test(receipt.bundleId ?? "") ||
      !admitted(old)
    )
      throw Error(`RMAN legacy receipt source membership mismatch ${id}`);
    const oldBytes = await legacy(old);
    if (key(old) === key(chunk)) return oldBytes;
    return scopedRead(chunk);
  }
  const read = async (chunk) => {
    const identity = key(chunk);
    if (pending.has(identity)) return pending.get(identity);
    const request = load(chunk);
    pending.set(identity, request);
    try {
      return await request;
    } finally {
      pending.delete(identity);
    }
  };
  read.receipts = () =>
    [
      ...legacy.receipts(),
      ...[...scoped.values()].flatMap((reader) => reader.receipts()),
    ].sort(
      (a, b) =>
        a.chunkId.localeCompare(b.chunkId) ||
        a.bundleId.localeCompare(b.bundleId) ||
        a.rangeStart - b.rangeStart,
    );
  return read;
}
