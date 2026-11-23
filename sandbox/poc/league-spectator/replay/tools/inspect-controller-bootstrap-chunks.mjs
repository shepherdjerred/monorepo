// Read-only cache/boundary inspection. Does not create a reader or fetch ranges.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readdir } from "node:fs/promises";
const [parserArg, cacheArg, fileArg] = process.argv.slice(2);
if (!fileArg)
  throw Error(
    "Usage: bun inspect-controller-bootstrap-chunks.mjs <pinned-RMAN-parser> <archive-cache> <exact-RMAN-file-name>",
  );
const raw = await Bun.file(path.join(cacheArg, "release.manifest")).bytes(),
  { parseRman } = await import(
    pathToFileURL(path.resolve(parserArg, "src/rman.js")).href
  ),
  manifest = parseRman(raw, { targetFile: fileArg });
if (manifest.files.length !== 1) throw Error("Exact RMAN file absent");
const file = manifest.files[0],
  directory = path.join(cacheArg, "chunks", manifest.manifestId),
  rows = [];
const names = new Set(await readdir(directory)),
  summary = {
    sourceChunkPositions: file.chunks.length,
    uniqueSourceChunks: new Set(file.chunks.map((chunk) => chunk.id.toString()))
      .size,
    payloadAndReceiptPresent: 0,
    payloadOnly: 0,
    receiptOnly: 0,
    missingBoth: 0,
    firstMissing: null,
    filenameOnly: true,
  };
for (let index = 0; index < file.chunks.length; index++) {
  const chunk = file.chunks[index],
    id = chunk.id.toString(16).toUpperCase().padStart(16, "0"),
    payload = names.has(id + ".bin"),
    receipt = names.has(id + ".json");
  if (payload && receipt) summary.payloadAndReceiptPresent++;
  else {
    if (payload) summary.payloadOnly++;
    else if (receipt) summary.receiptOnly++;
    else summary.missingBoth++;
    if (summary.firstMissing === null)
      summary.firstMissing = {
        index,
        id,
        bundle: chunk.bundleId.toString(16).toUpperCase().padStart(16, "0"),
        rangeStart: chunk.offset,
        compressedBytes: chunk.compressedSize,
        uncompressedBytes: chunk.uncompressedSize,
        payload,
        receipt,
      };
  }
}
const currentIndex = summary.firstMissing?.index ?? file.chunks.length,
  observedIndices = [
    ...new Set([
      0,
      Math.max(0, currentIndex - 1),
      currentIndex,
      Math.min(file.chunks.length - 1, currentIndex + 1),
      file.chunks.length - 1,
    ]),
  ].filter((index) => index < file.chunks.length),
  receiptTimes = [];
for (const index of observedIndices) {
  const id = file.chunks[index].id.toString(16).toUpperCase().padStart(16, "0");
  if (names.has(id + ".json"))
    receiptTimes.push({
      index,
      id,
      lastModifiedMs: Bun.file(path.join(directory, id + ".json")).lastModified,
    });
}
for (let index = 0; index < Math.min(file.chunks.length, 16); index++) {
  const chunk = file.chunks[index],
    id = chunk.id.toString(16).toUpperCase().padStart(16, "0"),
    payload = Bun.file(path.join(directory, id + ".bin")),
    receipt = Bun.file(path.join(directory, id + ".json")),
    row = {
      index,
      id,
      bundle: chunk.bundleId.toString(16).toUpperCase().padStart(16, "0"),
      rangeStart: chunk.offset,
      compressedBytes: chunk.compressedSize,
      uncompressedBytes: chunk.uncompressedSize,
      payloadExists: await payload.exists(),
      receiptExists: await receipt.exists(),
    };
  if (row.payloadExists) row.payloadBytes = payload.size;
  if (row.receiptExists) {
    const meta = await receipt.json();
    row.receiptSha256 = meta.sha256;
    row.receiptRange = [meta.rangeStart, meta.rangeEnd];
    if (row.payloadExists) {
      const bytes = await payload.bytes();
      row.payloadSha256 = new Bun.CryptoHasher("sha256")
        .update(bytes)
        .digest("hex");
      row.payloadMatchesReceipt = row.payloadSha256 === meta.sha256;
    }
  }
  rows.push(row);
}
console.log(
  JSON.stringify(
    {
      file: file.name,
      bytes: file.size,
      chunks: file.chunks.length,
      summary,
      receiptTimes,
      firstChunks: rows,
    },
    null,
    2,
  ),
);
