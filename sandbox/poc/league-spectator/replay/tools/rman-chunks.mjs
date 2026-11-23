import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const sha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const hexId = (value) =>
  BigInt(value).toString(16).toUpperCase().padStart(16, "0");

async function readBounded(response, expected) {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) !== expected)
    throw Error("Invalid bundle Content-Length");
  if (!response.body) throw Error("Missing bundle response body");
  const reader = response.body.getReader();
  const bytes = new Uint8Array(expected);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > expected)
        throw Error("Bundle response exceeded exact range length");
      bytes.set(value, offset);
      offset += value.length;
    }
    if (offset !== expected) throw Error("Truncated bundle range");
    return bytes;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

// RMAN chunk IDs are opaque. Receipts bind fetched bytes to the admitted release
// and exact CDN range; no unverified chunk-ID hash algorithm is assumed.
export async function createRmanChunkReader(manifest, cacheRoot, decompress) {
  if (!/^[0-9A-F]{16}$/.test(manifest.manifestId))
    throw Error("An exact RMAN release manifest ID is required");
  const sourceManifestSha256 = manifest.sourceSha256 ?? null;
  if (
    sourceManifestSha256 !== null &&
    !/^[a-f0-9]{64}$/.test(sourceManifestSha256)
  )
    throw Error("Invalid RMAN source manifest SHA256");
  const directory = join(cacheRoot, "chunks", manifest.manifestId);
  await mkdir(directory, { recursive: true });
  const pending = new Map();
  const receipts = new Map();

  async function load(chunk) {
    const chunkId = hexId(chunk.id),
      bundleId = hexId(chunk.bundleId);
    if (!/^[0-9A-F]{16}$/.test(chunkId) || !/^[0-9A-F]{16}$/.test(bundleId))
      throw Error("Invalid RMAN chunk or bundle ID");
    if (
      ![chunk.offset, chunk.compressedSize, chunk.uncompressedSize].every(
        Number.isSafeInteger,
      ) ||
      chunk.offset < 0 ||
      chunk.compressedSize <= 0 ||
      chunk.uncompressedSize <= 0 ||
      !Number.isSafeInteger(chunk.offset + chunk.compressedSize)
    )
      throw Error("Invalid RMAN chunk range");
    const identity = {
      schemaVersion: 1,
      manifestId: manifest.manifestId,
      sourceManifestSha256,
      chunkId,
      bundleId,
      rangeStart: chunk.offset,
      rangeEnd: chunk.offset + chunk.compressedSize - 1,
      compressedBytes: chunk.compressedSize,
      uncompressedBytes: chunk.uncompressedSize,
    };
    const payload = Bun.file(join(directory, `${chunkId}.bin`));
    const receiptFile = Bun.file(join(directory, `${chunkId}.json`));
    if (await receiptFile.exists()) {
      const receipt = await receiptFile.json();
      if (
        !receipt ||
        Object.entries(identity).some(
          ([key, value]) => receipt[key] !== value,
        ) ||
        !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
        !/^[a-f0-9]{64}$/.test(receipt.compressedSha256)
      )
        throw Error(`RMAN cache receipt identity mismatch ${chunkId}`);
      if (!(await payload.exists()) || payload.size !== chunk.uncompressedSize)
        throw Error(`RMAN cached payload size mismatch ${chunkId}`);
      const bytes = new Uint8Array(await payload.arrayBuffer());
      if (sha256(bytes) !== receipt.sha256)
        throw Error(`RMAN cached payload SHA256 mismatch ${chunkId}`);
      receipts.set(chunkId, receipt);
      return bytes;
    }

    // An unreceipted cache is never evidence. Re-fetch it once into this release
    // namespace, and publish its receipt only after both size checks pass.
    const response = await fetch(
      `https://lol.dyn.riotcdn.net/channels/public/bundles/${bundleId}.bundle`,
      {
        headers: { Range: `bytes=${identity.rangeStart}-${identity.rangeEnd}` },
      },
    );
    if (response.status !== 206)
      throw Error(
        `Bundle ${bundleId}: expected HTTP 206, got ${response.status}`,
      );
    const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
      response.headers.get("content-range") ?? "",
    );
    if (
      !contentRange ||
      Number(contentRange[1]) !== identity.rangeStart ||
      Number(contentRange[2]) !== identity.rangeEnd ||
      Number(contentRange[3]) <= identity.rangeEnd
    )
      throw Error(`Bundle ${bundleId}: invalid Content-Range`);
    const compressed = await readBounded(response, chunk.compressedSize);
    const bytes = decompress(compressed);
    if (bytes.length !== chunk.uncompressedSize)
      throw Error(`Invalid RMAN chunk length ${chunkId}`);
    await Bun.write(payload, bytes);
    const receipt = {
      ...identity,
      sha256: sha256(bytes),
      compressedSha256: sha256(compressed),
    };
    await Bun.write(receiptFile, JSON.stringify(receipt, null, 2));
    receipts.set(chunkId, receipt);
    return bytes;
  }

  const read = async (chunk) => {
    const key = `${chunk.id}:${chunk.bundleId}:${chunk.offset}:${chunk.compressedSize}:${chunk.uncompressedSize}`;
    if (pending.has(key)) return pending.get(key);
    const request = load(chunk);
    pending.set(key, request);
    try {
      return await request;
    } finally {
      pending.delete(key);
    }
  };
  read.receipts = () =>
    [...receipts.values()].sort((a, b) => a.chunkId.localeCompare(b.chunkId));
  return read;
}
