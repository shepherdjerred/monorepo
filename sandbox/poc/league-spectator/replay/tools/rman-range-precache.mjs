import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const hex = (value) =>
    BigInt(value).toString(16).toUpperCase().padStart(16, "0"),
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
export function planRmanRangeBatches(manifest, chunks) {
  if (
    !/^[A-F0-9]{16}$/.test(manifest.manifestId) ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceSha256 ?? "")
  )
    throw Error("Hashed exact RMAN source required");
  const bundles = new Map(
      manifest.bundles.map((bundle) => [hex(bundle.id), bundle.chunks]),
    ),
    unique = new Map();
  for (const chunk of chunks) {
    if (
      ![chunk.offset, chunk.compressedSize, chunk.uncompressedSize].every(
        Number.isSafeInteger,
      ) ||
      chunk.offset < 0 ||
      chunk.compressedSize <= 0 ||
      chunk.uncompressedSize <= 0 ||
      chunk.compressedSize > 8 * 1024 ** 2 ||
      !Number.isSafeInteger(chunk.offset + chunk.compressedSize)
    )
      throw Error("Bounded exact RMAN source range required");
    const rows = bundles.get(hex(chunk.bundleId));
    let lower = 0,
      upper = rows?.length ?? 0;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (rows[middle].offset < chunk.offset) lower = middle + 1;
      else upper = middle;
    }
    const source = rows?.[lower];
    if (
      !source ||
      hex(source.id) !== hex(chunk.id) ||
      source.offset !== chunk.offset ||
      source.compressedSize !== chunk.compressedSize ||
      source.uncompressedSize !== chunk.uncompressedSize
    )
      throw Error("Range chunk absent from original manifest");
    const id = hex(chunk.id),
      old = unique.get(id);
    if (
      old &&
      (old.bundleId !== chunk.bundleId ||
        old.offset !== chunk.offset ||
        old.compressedSize !== chunk.compressedSize ||
        old.uncompressedSize !== chunk.uncompressedSize)
    )
      throw Error("Precache cannot choose between same-ID locations");
    unique.set(id, chunk);
  }
  const ordered = [...unique.values()].sort(
      (a, b) =>
        hex(a.bundleId).localeCompare(hex(b.bundleId)) || a.offset - b.offset,
    ),
    batches = [];
  for (const chunk of ordered) {
    let batch = batches.at(-1);
    if (
      !batch ||
      batch.bundleId !== hex(chunk.bundleId) ||
      batch.end + 1 !== chunk.offset ||
      batch.chunks.length >= 1024 ||
      chunk.offset + chunk.compressedSize - batch.start > 8 * 1024 ** 2
    ) {
      batch = {
        bundleId: hex(chunk.bundleId),
        start: chunk.offset,
        end: chunk.offset - 1,
        chunks: [],
      };
      batches.push(batch);
    }
    batch.chunks.push(chunk);
    batch.end = chunk.offset + chunk.compressedSize - 1;
  }
  return batches;
}

async function exactBytes(response, batch) {
  const expected = batch.end - batch.start + 1,
    range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
      response.headers.get("content-range") ?? "",
    );
  if (
    response.status !== 206 ||
    !range ||
    Number(range[1]) !== batch.start ||
    Number(range[2]) !== batch.end ||
    Number(range[3]) <= batch.end ||
    (response.headers.has("content-length") &&
      Number(response.headers.get("content-length")) !== expected) ||
    !response.body
  )
    throw Error("Original bundle batch HTTP range differs");
  const reader = response.body.getReader(),
    bytes = new Uint8Array(expected);
  let offset = 0;
  try {
    for (;;) {
      const row = await reader.read();
      if (row.done) break;
      if (offset + row.value.length > expected)
        throw Error("Original bundle batch exceeds bound");
      bytes.set(row.value, offset);
      offset += row.value.length;
    }
    if (offset !== expected) throw Error("Original bundle batch is truncated");
    return bytes;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

// Only absent payload+receipt pairs are populated. Existing (including corrupt)
// receipts remain untouched and are validated later by the unchanged reader.
export async function precacheRmanRanges(
  manifest,
  cacheRoot,
  chunks,
  decompress,
) {
  const all = planRmanRangeBatches(manifest, chunks),
    directory = join(cacheRoot, "chunks", manifest.manifestId),
    missing = [];
  await mkdir(directory, { recursive: true });
  for (const chunk of all.flatMap((batch) => batch.chunks)) {
    const id = hex(chunk.id);
    if (
      !(await Bun.file(join(directory, id + ".json")).exists()) &&
      !(await Bun.file(join(directory, id + ".bin")).exists())
    )
      missing.push(chunk);
  }
  const missingIds = new Set(missing.map((chunk) => hex(chunk.id))),
    batches = all.filter((batch) =>
      batch.chunks.some((chunk) => missingIds.has(hex(chunk.id))),
    ),
    receipts = [];
  async function fill(batch) {
    const response = await fetch(
        `https://lol.dyn.riotcdn.net/channels/public/bundles/${batch.bundleId}.bundle`,
        { headers: { Range: `bytes=${batch.start}-${batch.end}` } },
      ),
      compressed = await exactBytes(response, batch),
      transport = {
        kind: "original-contiguous-bundle-range",
        bundleId: batch.bundleId,
        rangeStart: batch.start,
        rangeEnd: batch.end,
        compressedBytes: compressed.length,
        sha256: sha(compressed),
      };
    // Validate every chunk before publishing any portion of this batch.
    const expanded = batch.chunks.map((chunk) => {
      const start = chunk.offset - batch.start,
        packed = compressed.subarray(start, start + chunk.compressedSize),
        bytes = decompress(packed);
      if (bytes.length !== chunk.uncompressedSize)
        throw Error("Original batched chunk expanded size differs");
      return { chunk, bytes, packed };
    });
    for (const { chunk, bytes, packed } of expanded) {
      if (!missingIds.has(hex(chunk.id))) continue;
      const chunkId = hex(chunk.id),
        receipt = {
          schemaVersion: 1,
          manifestId: manifest.manifestId,
          sourceManifestSha256: manifest.sourceSha256,
          chunkId,
          bundleId: batch.bundleId,
          rangeStart: chunk.offset,
          rangeEnd: chunk.offset + chunk.compressedSize - 1,
          compressedBytes: chunk.compressedSize,
          uncompressedBytes: chunk.uncompressedSize,
          sha256: sha(bytes),
          compressedSha256: sha(packed),
          transport,
        };
      // Exclusive writes prevent a concurrent producer from replacing evidence.
      await writeFile(join(directory, chunkId + ".bin"), bytes, { flag: "wx" });
      await writeFile(
        join(directory, chunkId + ".json"),
        JSON.stringify(receipt),
        { flag: "wx" },
      );
    }
    return {
      ...transport,
      chunks: batch.chunks.length,
      populatedChunks: batch.chunks.filter((chunk) =>
        missingIds.has(hex(chunk.id)),
      ).length,
    };
  }
  for (let index = 0; index < batches.length; index += 4) {
    const results = await Promise.allSettled(
      batches.slice(index, index + 4).map(fill),
    );
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
    receipts.push(...results.map((result) => result.value));
  }
  return {
    sourceChunkPositions: chunks.length,
    uniqueChunks: all.reduce((sum, batch) => sum + batch.chunks.length, 0),
    newChunks: missing.length,
    batches: receipts,
  };
}
