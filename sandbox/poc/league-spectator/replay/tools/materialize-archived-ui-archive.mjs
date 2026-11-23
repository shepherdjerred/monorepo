// A fresh complete installation extends verified immutable bootstrap bytes.
// The archived UI WAD is never synthesized or exposed as public assets.
import path from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { createLocationScopedRmanChunkReader } from "./rman-location-chunks.mjs";
import { MAP11_RELEASE_SHA256 } from "./map-scene-assets.mjs";
import { openLocalWad } from "./wad.mjs";
import { precacheRmanRanges } from "./rman-range-precache.mjs";
const [parserArg, sourceArg, cacheArg, parentArg, reportArg, mode] =
  process.argv.slice(2);
if (!reportArg || ![undefined, "--materialize"].includes(mode))
  throw Error(
    "Usage: bun materialize-archived-ui-archive.mjs <RMAN-parser> <approved-cache> <archive-cache> <verified-scripts-manifest.json> <report.json> [--materialize]",
  );
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  releaseFile = path.resolve(cacheArg, "release.manifest"),
  release = await Bun.file(releaseFile).bytes(),
  parserFile = path.resolve(parserArg, "src/rman.js"),
  parserBytes = await Bun.file(parserFile).bytes();
if (sha(release) !== MAP11_RELEASE_SHA256)
  throw Error("Original archived release required");
const { parseRman } = await import(pathToFileURL(parserFile).href),
  manifest = parseRman(release);
manifest.sourceSha256 = sha(release);
if (manifest.manifestId !== "B499FB04B1158CF6")
  throw Error("Original archived release identity differs");
const parentBytes = await Bun.file(parentArg).bytes(),
  parent = JSON.parse(new TextDecoder().decode(parentBytes));
if (
  parent.kind !== "archived-original-controller-bootstrap-with-scripts" ||
  parent.build !== "16.21.829.8620" ||
  parent.protocol !== "20e09df23c66b85e" ||
  parent.releaseManifestSha256 !== sha(release) ||
  parent.releaseManifestId !== manifest.manifestId ||
  parent.scope.completeOriginalFiles !== true ||
  parent.files.length !== 5
)
  throw Error("Complete matching original bootstrap authority required");
if (sha(parserBytes) !== parent.parserSha256)
  throw Error("Original source-pinned parent RMAN parser changed");
for (const [file, digest] of Object.entries(parent.tools)) {
  if (!/^[A-Za-z0-9-]+\.mjs$/.test(file) || !/^[a-f0-9]{64}$/.test(digest))
    throw Error("Invalid original parent producer source identity");
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error("Original parent producer source changed: " + file);
}
const names = [
    "League of Legends.exe",
    "DATA/FINAL/DATA.wad.client",
    "DATA/FINAL/Global.wad.client",
    "DATA/FINAL/Bootstrap.windows.wad.client",
    "DATA/FINAL/Scripts.wad.client",
    "DATA/FINAL/UI.wad.client",
  ],
  plans = [];
for (const name of names) {
  const found = manifest.files.filter(
    (file) => file.name.toLowerCase() === name.toLowerCase(),
  );
  if (found.length !== 1)
    throw Error("Unique exact archived complete filename required: " + name);
  const file = found[0];
  if (
    file.link ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > 4 * 1024 ** 3 ||
    file.chunks.reduce((sum, row) => sum + row.uncompressedSize, 0) !==
      file.size
  )
    throw Error("Complete unlinked bounded original file required");
  const identity = file.chunks.map((row) => ({
    id: row.id.toString(),
    bundleId: row.bundleId.toString(),
    offset: row.offset,
    compressedSize: row.compressedSize,
    uncompressedSize: row.uncompressedSize,
  }));
  plans.push({
    originalName: file.name,
    file: "Game/" + name,
    bytes: file.size,
    orderedChunkIdentitySha256: sha(
      new TextEncoder().encode(JSON.stringify(identity)),
    ),
    chunks: file.chunks,
  });
}
for (const plan of plans.slice(0, 5)) {
  const old = parent.files.filter((row) => row.file === plan.file);
  if (
    old.length !== 1 ||
    old[0].bytes !== plan.bytes ||
    old[0].orderedChunkIdentitySha256 !== plan.orderedChunkIdentitySha256 ||
    !/^[a-f0-9]{64}$/.test(old[0].sha256)
  )
    throw Error("Original bootstrap file source identity differs");
  plan.parent = old[0];
}
if (
  plans[0].parent.sha256 !==
  "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a"
)
  throw Error("Approved original Windows executable required");
const tools = {};
for (const file of [
  "materialize-archived-ui-archive.mjs",
  "materialize-archived-script-archive.mjs",
  "rman-location-chunks.mjs",
  "rman-chunks.mjs",
  "rman-range-precache.mjs",
  "map-scene-output.mjs",
  "map-scene-assets.mjs",
  "wad.mjs",
])
  tools[file] = sha(await Bun.file(new URL(file, import.meta.url)).bytes());
async function hashFile(file) {
  const hash = new Bun.CryptoHasher("sha256"),
    reader = Bun.file(file).stream().getReader();
  let bytes = 0;
  try {
    for (;;) {
      const row = await reader.read();
      if (row.done) break;
      bytes += row.value.length;
      hash.update(row.value);
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes, sha256: hash.digest("hex") };
}
const ui = plans[5],
  report = {
    schema: 1,
    kind: "archived-original-controller-bootstrap-with-ui",
    build: parent.build,
    protocol: parent.protocol,
    releaseManifestId: manifest.manifestId,
    releaseManifestSha256: sha(release),
    parserSha256: sha(parserBytes),
    parentAuthoritySha256: sha(parentBytes),
    tools,
    ui: {
      originalName: ui.originalName,
      bytes: ui.bytes,
      chunks: ui.chunks.length,
      orderedChunkIdentitySha256: ui.orderedChunkIdentitySha256,
    },
    scope: {
      completeOriginalFiles: false,
      originalWadSignaturesVerified: false,
      nativeBootstrapExecuted: false,
      nativeRendererAdmitted: false,
    },
  };
if (ui.bytes !== 452053118 || ui.chunks.length !== 30807)
  throw Error("Exact original archived UI file identity differs");
if (mode) {
  const { work, out } = await createStaticPreparationOutput(
      sourceArg,
      cacheArg,
      { prefix: "controller-ui-", directory: "controller-ui" },
    ),
    installation = path.join(work, "installation"),
    parentInstallation = await realpath(parent.installationRoot),
    allowed = await realpath(path.resolve(cacheArg, "prepared"));
  if (!parentInstallation.startsWith(allowed + path.sep))
    throw Error(
      "Original bootstrap installation escaped selected archive cache",
    );
  const outputs = [];
  for (const plan of plans.slice(0, 5)) {
    const original = await realpath(path.join(parentInstallation, plan.file));
    if (!original.startsWith(parentInstallation + path.sep))
      throw Error("Original bootstrap file escaped declared installation");
    const verified = await hashFile(original);
    if (verified.bytes !== plan.bytes || verified.sha256 !== plan.parent.sha256)
      throw Error("Original bootstrap full file readback differs");
    const destination = path.join(installation, plan.file);
    await mkdir(path.dirname(destination), { recursive: true });
    if (await Bun.file(destination).exists())
      throw Error("Fresh original installation required");
    await Bun.write(destination, Bun.file(original));
    const copied = await hashFile(destination);
    if (copied.bytes !== verified.bytes || copied.sha256 !== verified.sha256)
      throw Error("Copied original full file readback differs");
    const toc = plan.parent.subchunkToc;
    if (toc) {
      if (
        !/^(?:subchunk-toc\/[A-Za-z0-9_.-]+\.bin|Scripts\.wad\.subchunktoc\.bin)$/.test(
          toc.file,
        )
      )
        throw Error("Bounded original subchunk receipt path required");
      const sourceToc = await realpath(
        path.join(path.dirname(parentInstallation), toc.file),
      );
      if (!sourceToc.startsWith(path.dirname(parentInstallation) + path.sep))
        throw Error("Original subchunk receipt escaped parent");
      const bytes = await Bun.file(sourceToc).bytes();
      if (bytes.length !== toc.bytes || sha(bytes) !== toc.sha256)
        throw Error("Original subchunk table bytes differ");
      const targetToc = path.join(work, toc.file);
      await mkdir(path.dirname(targetToc), { recursive: true });
      await Bun.write(targetToc, bytes);
      if (sha(await Bun.file(targetToc).bytes()) !== toc.sha256)
        throw Error("Copied original subchunk table differs");
    }
    outputs.push({ ...plan.parent, parentAuthoritySha256: sha(parentBytes) });
    console.log(JSON.stringify({ copied: plan.file, ...copied }));
  }
  // Observe the exact transport boundary without changing the shared reader or
  // weakening any HTTP206/range/length validation. Never record cookies or
  // other unrelated response headers. This wrapper belongs to this CLI only.
  const originalFetch = globalThis.fetch;
  report.network = [];
  globalThis.fetch = async (request, options) => {
    const response = await originalFetch(request, options);
    const observation = {
      url: String(request),
      requestedRange: new Headers(options?.headers).get("range"),
      status: response.status,
      contentRange: response.headers.get("content-range"),
      contentLength: response.headers.get("content-length"),
      contentEncoding: response.headers.get("content-encoding"),
    };
    report.network.push(observation);
    console.log(JSON.stringify({ originalRangeResponse: observation }));
    return response;
  };
  try {
    report.rangePrecache = await precacheRmanRanges(
      manifest,
      path.resolve(cacheArg),
      ui.chunks,
      (bytes) => Bun.zstdDecompressSync(bytes),
    );
  } catch (error) {
    report.boundary = {
      phase: "original-ui-bundle-range",
      message: String(error),
    };
    await Bun.write(reportArg, JSON.stringify(report));
    throw error;
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log(
    JSON.stringify({
      precache: {
        chunks: report.rangePrecache.newChunks,
        batches: report.rangePrecache.batches.length,
      },
    }),
  );
  const read = await createLocationScopedRmanChunkReader(
      manifest,
      path.resolve(cacheArg),
      (bytes) => Bun.zstdDecompressSync(bytes),
    ),
    destination = path.join(installation, ui.file),
    sink = Bun.file(destination).writer(),
    hash = new Bun.CryptoHasher("sha256"),
    pending = new Map();
  let written = 0;
  const enqueue = (index) => {
    if (index < ui.chunks.length)
      pending.set(
        index,
        read(ui.chunks[index]).then(
          (value) => ({ value }),
          (error) => ({ error }),
        ),
      );
  };
  for (let index = 0; index < Math.min(8, ui.chunks.length); index++)
    enqueue(index);
  try {
    for (let index = 0; index < ui.chunks.length; index++) {
      const row = await pending.get(index);
      pending.delete(index);
      if (row.error) throw row.error;
      const data = row.value;
      if (data.length !== ui.chunks[index].uncompressedSize)
        throw Error("Original UI chunk length differs");
      sink.write(data);
      hash.update(data);
      written += data.length;
      enqueue(index + 8);
    }
  } finally {
    await Promise.all(pending.values());
    await sink.end();
  }
  const digest = hash.digest("hex"),
    readback = await hashFile(destination);
  if (
    written !== ui.bytes ||
    readback.bytes !== ui.bytes ||
    readback.sha256 !== digest
  )
    throw Error("Complete original UI file readback differs");
  const header = await Bun.file(destination).slice(0, 272).bytes(),
    view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (
    header.length !== 272 ||
    header[0] !== 82 ||
    header[1] !== 87 ||
    header[2] !== 3 ||
    header[3] !== 4 ||
    272 + view.getUint32(268, true) * 32 > ui.bytes
  )
    throw Error("Original signed WAD3.4 index required");
  const wad = await openLocalWad(installation, ui.originalName, (bytes) =>
      Bun.zstdDecompressSync(bytes),
    ),
    tocName = ui.originalName.replace(/\.client$/i, ".subchunktoc");
  let subchunkToc = null;
  if (wad.has(tocName)) {
    const toc = await wad(tocName),
      file = "UI.wad.subchunktoc.bin";
    await Bun.write(path.join(work, file), toc);
    subchunkToc = {
      file,
      originalNamespace: tocName,
      bytes: toc.length,
      sha256: sha(toc),
    };
  }
  outputs.push({
    file: ui.file,
    originalName: ui.originalName,
    bytes: ui.bytes,
    sha256: digest,
    orderedChunkIdentitySha256: ui.orderedChunkIdentitySha256,
    wad: {
      version: [3, 4],
      entries: view.getUint32(268, true),
      originalHeaderSha256: sha(header),
      nativeSignatureAdmission: false,
    },
    subchunkToc,
  });
  report.installationRoot = installation;
  report.files = outputs;
  report.rmanReceipts = read.receipts();
  report.scope.completeOriginalFiles = true;
  for (const [file, digest] of Object.entries(tools))
    if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
      throw Error("Original UI materializer source changed");
  if (
    sha(await Bun.file(parentArg).bytes()) !== sha(parentBytes) ||
    sha(await Bun.file(releaseFile).bytes()) !== sha(release) ||
    sha(await Bun.file(parserFile).bytes()) !== sha(parserBytes)
  )
    throw Error("Original UI materializer input authority changed");
  await Bun.write(path.join(out, "manifest.json"), JSON.stringify(report));
  report.receipt = path.join(out, "manifest.json");
}
await Bun.write(reportArg, JSON.stringify(report));
console.log(
  JSON.stringify({ ...report, tools: undefined, rmanReceipts: undefined }),
);
