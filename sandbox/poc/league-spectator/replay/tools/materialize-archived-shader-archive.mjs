// Reconstruct the exact shader archive required by the frozen shader compiler.
// Parent installation, original receipts and prepared shader packages stay
// immutable. This publishes private offline inputs, never rendering admission.
import path from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { MAP11_RELEASE_SHA256 } from "./map-scene-assets.mjs";
import { createLocationScopedRmanChunkReader } from "./rman-location-chunks.mjs";
import { precacheRmanRanges } from "./rman-range-precache.mjs";
import { openLocalWad } from "./wad.mjs";
import { captureResearchSourceClosure } from "./research-source-closure.mjs";

const [
  parserRoot,
  sourceCache,
  archiveCache,
  parentFile,
  shaderReferenceFile,
  reportFile,
  mode,
] = process.argv.slice(2);
if (!reportFile || ![undefined, "--materialize"].includes(mode))
  throw Error(
    "Usage: bun materialize-archived-shader-archive.mjs <RMAN-parser> <approved-cache> <archive-cache> <complete-ui-manifest.json> <frozen-shader-package.json> <report.json> [--materialize]",
  );
async function canonicalOutput(file) {
  let current = path.resolve(file);
  const suffix = [];
  for (;;) {
    try {
      return path.join(await realpath(current), ...suffix);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      suffix.unshift(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}
const fold = (file) =>
    process.platform === "win32" ? file.toLowerCase() : file,
  reportTarget = fold(await canonicalOutput(reportFile));
for (const root of [sourceCache, archiveCache, parserRoot]) {
  const protectedRoot = fold(await realpath(path.resolve(root)));
  if (
    reportTarget === protectedRoot ||
    reportTarget.startsWith(protectedRoot + path.sep)
  )
    throw Error("Shader report must be outside retained input roots");
}
for (const file of [parentFile, shaderReferenceFile])
  if (reportTarget === fold(await realpath(path.resolve(file))))
    throw Error("Shader report cannot replace an input authority");
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  sourceBefore = await captureResearchSourceClosure([new URL(import.meta.url)]),
  releaseFile = path.resolve(archiveCache, "release.manifest"),
  releaseBytes = await Bun.file(releaseFile).bytes(),
  parserFile = path.resolve(parserRoot, "src/rman.js"),
  parserBytes = await Bun.file(parserFile).bytes(),
  parentBytes = await Bun.file(parentFile).bytes(),
  parent = decode(parentBytes),
  shaderReferenceBytes = await Bun.file(shaderReferenceFile).bytes(),
  shaderReference = decode(shaderReferenceBytes);
if (sha(releaseBytes) !== MAP11_RELEASE_SHA256)
  throw Error("Exact original archived release required");
if (sha(parserBytes) !== parent.parserSha256)
  throw Error("Original parent RMAN parser changed before import");
const { parseRman } = await import(pathToFileURL(parserFile).href),
  release = parseRman(releaseBytes);
release.sourceSha256 = sha(releaseBytes);
if (
  release.manifestId !== "B499FB04B1158CF6" ||
  parent.kind !== "archived-original-controller-bootstrap-with-ui" ||
  parent.build !== "16.21.829.8620" ||
  parent.protocol !== "20e09df23c66b85e" ||
  parent.releaseManifestSha256 !== sha(releaseBytes) ||
  parent.releaseManifestId !== release.manifestId ||
  parent.parserSha256 !== sha(parserBytes) ||
  parent.scope?.completeOriginalFiles !== true ||
  parent.files?.length !== 6 ||
  shaderReference.schema !== 1 ||
  shaderReference.kind !== "installed-particle-shader-translations" ||
  shaderReference.build !== parent.build ||
  shaderReference.compiler?.pipelineVersion !== 4 ||
  shaderReference.executableSha256 !==
    "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a" ||
  shaderReference.archive !== "DATA/FINAL/ShaderCache.dx11.wad.client" ||
  shaderReference.archiveSha256 !==
    "f3b38e7ef9d5becf24e492a2540c7d5e753ad6624d112d09c997fe43f53b1d18"
)
  throw Error(
    "Complete matching original UI installation and frozen shader authority required",
  );
for (const [file, digest] of Object.entries(parent.tools)) {
  if (
    !/^[A-Za-z0-9-]+\.mjs$/.test(file) ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest
  )
    throw Error("Original parent producer identity differs: " + file);
}
const names = [
    "League of Legends.exe",
    "DATA/FINAL/DATA.wad.client",
    "DATA/FINAL/Global.wad.client",
    "DATA/FINAL/Bootstrap.windows.wad.client",
    "DATA/FINAL/Scripts.wad.client",
    "DATA/FINAL/UI.wad.client",
    shaderReference.archive,
  ],
  plans = [];
for (const name of names) {
  const matches = release.files.filter(
    (file) => file.name.toLowerCase() === name.toLowerCase(),
  );
  if (matches.length !== 1)
    throw Error("Unique exact archived file required: " + name);
  const file = matches[0];
  if (
    file.link ||
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > 4 * 1024 ** 3 ||
    file.chunks.reduce((sum, row) => sum + row.uncompressedSize, 0) !==
      file.size
  )
    throw Error("Bounded complete original archive required");
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
    chunks: file.chunks,
    orderedChunkIdentitySha256: sha(
      new TextEncoder().encode(JSON.stringify(identity)),
    ),
  });
}
for (const plan of plans.slice(0, 6)) {
  const old = parent.files.filter((file) => file.file === plan.file);
  if (
    old.length !== 1 ||
    old[0].bytes !== plan.bytes ||
    old[0].orderedChunkIdentitySha256 !== plan.orderedChunkIdentitySha256 ||
    !/^[a-f0-9]{64}$/.test(old[0].sha256)
  )
    throw Error("Original parent file identity differs");
  plan.parent = old[0];
}
if (
  plans[0].parent.sha256 !== shaderReference.executableSha256 ||
  plans[6].bytes !== 43344890 ||
  plans[6].chunks.length !== 2934
)
  throw Error("Exact frozen executable/shader archive plan required");
const report = {
  schema: 1,
  kind: "archived-original-controller-bootstrap-with-shaders",
  build: parent.build,
  protocol: parent.protocol,
  releaseManifestId: release.manifestId,
  releaseManifestSha256: sha(releaseBytes),
  parserSha256: sha(parserBytes),
  parentAuthoritySha256: sha(parentBytes),
  shaderReferenceSha256: sha(shaderReferenceBytes),
  shader: {
    originalName: plans[6].originalName,
    bytes: plans[6].bytes,
    chunks: plans[6].chunks.length,
    expectedSha256: shaderReference.archiveSha256,
    orderedChunkIdentitySha256: plans[6].orderedChunkIdentitySha256,
  },
  scope: {
    completeOriginalFiles: false,
    nativeSignatureAdmission: false,
    shaderCompilationExecuted: false,
    nativeRendererAdmitted: false,
  },
};
async function hashFile(file) {
  const hash = new Bun.CryptoHasher("sha256");
  let bytes = 0;
  for await (const chunk of Bun.file(file).stream()) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}
if (mode) {
  const { work, out } = await createStaticPreparationOutput(
      sourceCache,
      archiveCache,
      { prefix: "controller-shaders-", directory: "controller-shaders" },
    ),
    installation = path.join(work, "installation"),
    parentInstallation = await realpath(parent.installationRoot),
    allowed = await realpath(path.resolve(archiveCache, "prepared")),
    files = [];
  if (!parentInstallation.startsWith(allowed + path.sep))
    throw Error("Parent installation escaped archive cache");
  for (const plan of plans.slice(0, 6)) {
    const original = await realpath(path.join(parentInstallation, plan.file));
    if (!original.startsWith(parentInstallation + path.sep))
      throw Error("Original parent file escaped installation");
    const verified = await hashFile(original);
    if (verified.bytes !== plan.bytes || verified.sha256 !== plan.parent.sha256)
      throw Error("Original parent full-file readback differs");
    const target = path.join(installation, plan.file);
    if (await Bun.file(target).exists())
      throw Error("Fresh shader installation required");
    await mkdir(path.dirname(target), { recursive: true });
    await Bun.write(target, Bun.file(original));
    const copied = await hashFile(target);
    if (copied.bytes !== verified.bytes || copied.sha256 !== verified.sha256)
      throw Error("Parent copy readback differs");
    if (plan.parent.subchunkToc) {
      const toc = plan.parent.subchunkToc;
      if (
        !/^(?:subchunk-toc\/[A-Za-z0-9_.-]+\.bin|(?:Scripts|UI)\.wad\.subchunktoc\.bin)$/.test(
          toc.file,
        )
      )
        throw Error("Bounded original subchunk receipt path required");
      const originalToc = await realpath(
        path.join(path.dirname(parentInstallation), toc.file),
      );
      if (!originalToc.startsWith(path.dirname(parentInstallation) + path.sep))
        throw Error("Parent subchunk table escaped installation");
      const bytes = await Bun.file(originalToc).bytes();
      if (bytes.length !== toc.bytes || sha(bytes) !== toc.sha256)
        throw Error("Original subchunk table differs");
      const targetToc = path.join(work, toc.file);
      await mkdir(path.dirname(targetToc), { recursive: true });
      await Bun.write(targetToc, bytes);
      if (sha(await Bun.file(targetToc).bytes()) !== toc.sha256)
        throw Error("Subchunk copy readback differs");
    }
    files.push({ ...plan.parent, parentAuthoritySha256: sha(parentBytes) });
    console.log(JSON.stringify({ copied: plan.file, ...copied }));
  }
  const shader = plans[6];
  try {
    report.rangePrecache = await precacheRmanRanges(
      release,
      path.resolve(archiveCache),
      shader.chunks,
      (bytes) => Bun.zstdDecompressSync(bytes),
    );
    const read = await createLocationScopedRmanChunkReader(
        release,
        path.resolve(archiveCache),
        (bytes) => Bun.zstdDecompressSync(bytes),
      ),
      destination = path.join(installation, shader.file);
    await mkdir(path.dirname(destination), { recursive: true });
    const sink = Bun.file(destination).writer(),
      hash = new Bun.CryptoHasher("sha256"),
      pending = new Map();
    let written = 0;
    const enqueue = (index) => {
      if (index < shader.chunks.length)
        pending.set(
          index,
          read(shader.chunks[index]).then(
            (value) => ({ value }),
            (error) => ({ error }),
          ),
        );
    };
    for (let i = 0; i < Math.min(8, shader.chunks.length); i++) enqueue(i);
    try {
      for (let i = 0; i < shader.chunks.length; i++) {
        const row = await pending.get(i);
        pending.delete(i);
        if (row.error) throw row.error;
        if (row.value.length !== shader.chunks[i].uncompressedSize)
          throw Error("Shader chunk length differs");
        sink.write(row.value);
        hash.update(row.value);
        written += row.value.length;
        enqueue(i + 8);
      }
    } finally {
      await Promise.all(pending.values());
      await sink.end();
    }
    const digest = hash.digest("hex"),
      verified = await hashFile(destination);
    if (
      written !== shader.bytes ||
      verified.bytes !== shader.bytes ||
      digest !== verified.sha256 ||
      digest !== shaderReference.archiveSha256
    )
      throw Error(
        "Complete shader archive differs from frozen compiler authority",
      );
    const header = await Bun.file(destination).slice(0, 272).bytes(),
      view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (
      header.length !== 272 ||
      header[0] !== 82 ||
      header[1] !== 87 ||
      header[2] !== 3 ||
      header[3] !== 4 ||
      272 + view.getUint32(268, true) * 32 > shader.bytes
    )
      throw Error("Original signed WAD3.4 index required");
    const wad = await openLocalWad(installation, shader.originalName, (bytes) =>
        Bun.zstdDecompressSync(bytes),
      ),
      tocName = shader.originalName.replace(/\.client$/i, ".subchunktoc");
    let subchunkToc = null;
    if (wad.has(tocName)) {
      const bytes = await wad(tocName),
        file = "ShaderCache.dx11.wad.subchunktoc.bin";
      await Bun.write(path.join(work, file), bytes);
      if (sha(await Bun.file(path.join(work, file)).bytes()) !== sha(bytes))
        throw Error("Shader subchunk table readback differs");
      subchunkToc = {
        file,
        originalNamespace: tocName,
        bytes: bytes.length,
        sha256: sha(bytes),
      };
    }
    files.push({
      file: shader.file,
      originalName: shader.originalName,
      bytes: shader.bytes,
      sha256: digest,
      orderedChunkIdentitySha256: shader.orderedChunkIdentitySha256,
      wad: {
        version: [3, 4],
        entries: view.getUint32(268, true),
        originalHeaderSha256: sha(header),
        nativeSignatureAdmission: false,
      },
      subchunkToc,
    });
    report.installationRoot = installation;
    report.files = files;
    report.rmanReceipts = read.receipts();
  } catch (error) {
    report.boundary = {
      phase: "original-shader-archive",
      message: String(error),
    };
    await Bun.write(reportFile, JSON.stringify(report));
    throw error;
  }
  report.scope.completeOriginalFiles = true;
  report.sourceBefore = sourceBefore;
  report.sourceAfter = await captureResearchSourceClosure([
    new URL(import.meta.url),
  ]);
  if (
    JSON.stringify(report.sourceBefore) !==
      JSON.stringify(report.sourceAfter) ||
    sha(await Bun.file(parentFile).bytes()) !== sha(parentBytes) ||
    sha(await Bun.file(releaseFile).bytes()) !== sha(releaseBytes) ||
    sha(await Bun.file(parserFile).bytes()) !== sha(parserBytes) ||
    sha(await Bun.file(shaderReferenceFile).bytes()) !==
      sha(shaderReferenceBytes)
  )
    throw Error("Original shader materializer source/input authority changed");
  await Bun.write(path.join(out, "manifest.json"), JSON.stringify(report));
  report.receipt = path.join(out, "manifest.json");
}
await Bun.write(reportFile, JSON.stringify(report));
console.log(
  JSON.stringify({
    reportFile,
    installationRoot: report.installationRoot,
    receipt: report.receipt,
    shader: report.shader,
    completeOriginalFiles: report.scope.completeOriginalFiles,
    nativeRendererAdmitted: false,
  }),
);
