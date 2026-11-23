// Read-only source membership evidence; never opens a downloading chunk reader.
import path from "node:path";
import { pathToFileURL } from "node:url";
const [parserRoot, cacheRoot, wanted] = process.argv.slice(2);
if (!/^[A-F0-9]{16}$/.test(wanted ?? ""))
  throw Error("Exact uppercase chunk ID required");
const source = await Bun.file(path.join(cacheRoot, "release.manifest")).bytes();
const { parseRman } = await import(
  pathToFileURL(path.resolve(parserRoot, "src/rman.js")).href
);
const manifest = parseRman(source),
  hex = (value) => value.toString(16).toUpperCase().padStart(16, "0");
const locations = manifest.bundles.flatMap((bundle) =>
  bundle.chunks
    .filter((chunk) => hex(chunk.id) === wanted)
    .map((chunk) => ({
      chunkId: hex(chunk.id),
      bundleId: hex(chunk.bundleId),
      rangeStart: chunk.offset,
      rangeEnd: chunk.offset + chunk.compressedSize - 1,
      compressedBytes: chunk.compressedSize,
      uncompressedBytes: chunk.uncompressedSize,
    })),
);
const files = manifest.files.flatMap((file) =>
  file.chunks.flatMap((chunk, index) =>
    hex(chunk.id) === wanted
      ? [
          {
            file: file.name,
            index,
            bundleId: hex(chunk.bundleId),
            rangeStart: chunk.offset,
          },
        ]
      : [],
  ),
);
const receipt = await Bun.file(
  path.join(cacheRoot, "chunks", manifest.manifestId, `${wanted}.json`),
).json();
console.log(
  JSON.stringify(
    {
      manifestId: manifest.manifestId,
      sourceSha256: new Bun.CryptoHasher("sha256").update(source).digest("hex"),
      locations,
      files,
      receipt,
    },
    null,
    2,
  ),
);
