// Complete original files only. Partial downloads have no final receipt and are
// never a synthetic installation. Native WAD signature admission remains native.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { createLocationScopedRmanChunkReader } from "./rman-location-chunks.mjs";
import { openLocalWad } from "./wad.mjs";
import { MAP11_RELEASE_SHA256 } from "./map-scene-assets.mjs";
const [parserArg, sourceArg, cacheArg, reportArg, mode] = process.argv.slice(2);
if (!reportArg || ![undefined, "--materialize"].includes(mode))
  throw Error(
    "Usage: bun materialize-archived-controller-bootstrap.mjs <pinned-RMAN-parser> <approved-cache> <archive-cache> <report.json> [--materialize]",
  );
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
  releaseFile = path.resolve(cacheArg, "release.manifest"),
  release = await Bun.file(releaseFile).bytes();
if (sha(release) !== MAP11_RELEASE_SHA256)
  throw Error("Pinned original16.21 archived release required");
const parserFile = path.resolve(parserArg, "src/rman.js"),
  parserBytes = await Bun.file(parserFile).bytes(),
  { parseRman } = await import(pathToFileURL(parserFile).href),
  manifest = parseRman(release);
if (manifest.manifestId !== "B499FB04B1158CF6")
  throw Error("Original archived release identity differs");
manifest.sourceSha256 = MAP11_RELEASE_SHA256;
const wanted = [
    {
      name: "League of Legends.exe",
      target: "Game/League of Legends.exe",
      exe: true,
    },
    {
      name: "DATA/FINAL/DATA.wad.client",
      target: "Game/DATA/FINAL/DATA.wad.client",
    },
    {
      name: "DATA/FINAL/Global.wad.client",
      target: "Game/DATA/FINAL/Global.wad.client",
    },
    {
      name: "DATA/FINAL/Bootstrap.windows.wad.client",
      target: "Game/DATA/FINAL/Bootstrap.windows.wad.client",
    },
  ],
  plans = [];
for (const request of wanted) {
  const matches = manifest.files.filter(
    (file) => file.name.toLowerCase() === request.name.toLowerCase(),
  );
  if (matches.length !== 1)
    throw Error(
      `One exact original RMAN file required: ${request.name} (found${matches.length})`,
    );
  const file = matches[0],
    total = file.chunks.reduce((sum, chunk) => sum + chunk.uncompressedSize, 0);
  if (
    file.link ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > 4 * 1024 ** 3 ||
    total !== file.size
  )
    throw Error("Complete unlinked bounded original RMAN file required");
  const chunkIdentity = file.chunks.map((chunk) => ({
    id: chunk.id.toString(),
    bundleId: chunk.bundleId.toString(),
    offset: chunk.offset,
    compressedSize: chunk.compressedSize,
    uncompressedSize: chunk.uncompressedSize,
  }));
  plans.push({
    ...request,
    originalName: file.name,
    bytes: file.size,
    orderedChunkIdentitySha256: sha(
      new TextEncoder().encode(JSON.stringify(chunkIdentity)),
    ),
    chunkCount: file.chunks.length,
    compressedBytes: file.chunks.reduce(
      (sum, chunk) => sum + chunk.compressedSize,
      0,
    ),
    chunks: file.chunks,
  });
}
const tools = {};
for (const file of [
  "materialize-archived-controller-bootstrap.mjs",
  "map-scene-output.mjs",
  "rman-chunks.mjs",
  "rman-location-chunks.mjs",
  "wad.mjs",
  "map-scene-assets.mjs",
])
  tools[file] = sha(await Bun.file(new URL(file, import.meta.url)).bytes());
const report = {
  schema: 1,
  kind: "archived-original-controller-bootstrap",
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  releaseManifestId: manifest.manifestId,
  releaseManifestSha256: sha(release),
  parserSha256: sha(parserBytes),
  mode: mode ? "materialize" : "inventory-only",
  rmanCacheIdentity: "verified-manifest-source-location",
  files: plans.map(({ chunks, ...entry }) => entry),
  tools,
  totalBytes: plans.reduce((sum, file) => sum + file.bytes, 0),
  scope: {
    completeOriginalFiles: false,
    originalWadSignaturesVerified: false,
    nativeBootstrapExecuted: false,
    nativeRendererAdmitted: false,
  },
};
if (mode) {
  const { work, out } = await createStaticPreparationOutput(
      sourceArg,
      cacheArg,
      { prefix: "controller-bootstrap-", directory: "controller-bootstrap" },
    ),
    installation = path.join(work, "installation"),
    readChunk = await createLocationScopedRmanChunkReader(
      manifest,
      path.resolve(cacheArg),
      (bytes) => Bun.zstdDecompressSync(bytes),
    );
  const outputs = [];
  for (const file of plans) {
    const destination = path.join(installation, file.target);
    await mkdir(path.dirname(destination), { recursive: true });
    if (await Bun.file(destination).exists())
      throw Error("Original controller output must be fresh");
    const sink = Bun.file(destination).writer(),
      hasher = new Bun.CryptoHasher("sha256"),
      pending = new Map();
    let written = 0;
    const enqueue = (index) => {
      if (index < file.chunks.length)
        pending.set(
          index,
          readChunk(file.chunks[index]).then(
            (value) => ({ value }),
            (error) => ({ error }),
          ),
        );
    };
    for (let index = 0; index < Math.min(8, file.chunks.length); index++)
      enqueue(index);
    try {
      for (let index = 0; index < file.chunks.length; index++) {
        const result = await pending.get(index);
        pending.delete(index);
        if (result.error) throw result.error;
        const bytes = result.value;
        if (bytes.length !== file.chunks[index].uncompressedSize)
          throw Error("Original controller chunk length differs");
        sink.write(bytes);
        hasher.update(bytes);
        written += bytes.length;
        enqueue(index + 8);
      }
      await sink.end();
    } finally {
      await Promise.all(pending.values());
      if (written !== file.bytes) await sink.end();
    }
    const digest = hasher.digest("hex");
    if (written !== file.bytes || Bun.file(destination).size !== file.bytes)
      throw Error("Complete original file length differs");
    const verify = new Bun.CryptoHasher("sha256"),
      reader = Bun.file(destination).stream().getReader();
    let count = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        verify.update(value);
        count += value.length;
      }
    } finally {
      reader.releaseLock();
    }
    if (count !== file.bytes || verify.digest("hex") !== digest)
      throw Error("Original full file readback differs");
    if (
      file.exe &&
      digest !==
        "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a"
    )
      throw Error("Original Windows16.21 executable SHA256 differs");
    const output = {
      file: file.target,
      originalName: file.originalName,
      bytes: file.bytes,
      sha256: digest,
      orderedChunkIdentitySha256: file.orderedChunkIdentitySha256,
    };
    if (!file.exe) {
      const header = await Bun.file(destination).slice(0, 272).bytes(),
        view = new DataView(
          header.buffer,
          header.byteOffset,
          header.byteLength,
        );
      if (
        header.length !== 272 ||
        header[0] !== 82 ||
        header[1] !== 87 ||
        header[2] !== 3 ||
        header[3] !== 4 ||
        272 + view.getUint32(268, true) * 32 > file.bytes
      )
        throw Error("Exact original full WAD3.4 index required");
      const wad = await openLocalWad(installation, file.originalName, (bytes) =>
          Bun.zstdDecompressSync(bytes),
        ),
        tocName = file.originalName.replace(/\.client$/i, ".subchunktoc");
      output.wad = {
        version: [header[2], header[3]],
        entries: view.getUint32(268, true),
        originalHeaderSha256: sha(header),
        nativeSignatureAdmission: false,
      };
      if (wad.has(tocName)) {
        const toc = await wad(tocName),
          relative = `subchunk-toc/${path.basename(tocName)}.bin`;
        await mkdir(path.join(work, "subchunk-toc"), { recursive: true });
        await Bun.write(path.join(work, relative), toc);
        output.subchunkToc = {
          file: relative,
          originalNamespace: tocName,
          bytes: toc.length,
          sha256: sha(toc),
        };
      } else output.subchunkToc = null;
    }
    outputs.push(output);
    console.log(
      JSON.stringify({
        file: file.target,
        bytes: file.bytes,
        sha256: digest,
        completed: outputs.length,
        total: plans.length,
      }),
    );
  }
  report.installationRoot = installation;
  report.files = outputs;
  report.rmanReceipts = readChunk.receipts();
  report.scope.completeOriginalFiles = true;
  for (const [file, digest] of Object.entries(tools))
    if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
      throw Error("Original full-file producer source changed");
  if (
    sha(await Bun.file(releaseFile).bytes()) !== sha(release) ||
    sha(await Bun.file(parserFile).bytes()) !== sha(parserBytes)
  )
    throw Error("Original full-file manifest/parser changed");
  await Bun.write(path.join(out, "manifest.json"), JSON.stringify(report));
  report.receipt = path.join(out, "manifest.json");
}
await Bun.write(reportArg, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({ ...report, tools: undefined, rmanReceipts: undefined }),
);
