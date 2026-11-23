// Exact archived shader/global declarations for original registry preparation.
// This records source bytes, not successful native resource registration.
import path from "node:path";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import {
  openArchivedActorSources,
  actorSha256 as sha,
} from "./archived-actor-sources.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import {
  readActorMetaNames,
  normalizeActorBin,
} from "./archived-actor-bin.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";
const [parserArg, sourceArg, cacheArg] = process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun inspect-archived-shader-globals.mjs <pinned-RMAN-parser> <approved-cache> <archive-cache>",
  );
const { sourceCache, cache, out } = await createStaticPreparationOutput(
    sourceArg,
    cacheArg,
    { prefix: "shader-global-sources-", directory: "shader-global-sources" },
  ),
  source = await openArchivedActorSources({
    parserCheckout: parserArg,
    sourceCache,
    archiveCache: cache,
  }),
  names = readActorMetaNames(
    await Bun.file(
      path.join(
        sourceCache,
        "research/LeagueToolkit/src/LeagueToolkit.Meta.Classes/Classes.cs",
      ),
    ).text(),
  ),
  files = [],
  records = [],
  tools = {};
for (const file of [
  "inspect-archived-shader-globals.mjs",
  "archived-actor-sources.mjs",
  "archived-actor-bin.mjs",
  "exact-map-bin.mjs",
  "wad.mjs",
  "rman-chunks.mjs",
  "map-scene-output.mjs",
  "asset-json.mjs",
])
  tools[file] = sha(await Bun.file(new URL(file, import.meta.url)).bytes());
for (const [wad, file] of [
  ["DATA/FINAL/Global.wad.client", "data/shaders/shaders.bin"],
  ["DATA/FINAL/Bootstrap.windows.wad.client", "assets/shaders/shareddata.bin"],
]) {
  const raw = await source.read(wad, file),
    tree = readExactMapBin(raw, "16.21.829.8620", { captureFieldSpans: true }),
    index = records.length;
  const rawFile = `bin-${index}.bin`,
    typedFile = `bin-${index}.typed.json`,
    namedFile = `bin-${index}.json`;
  for (const [target, bytes] of [
    [rawFile, raw],
    [typedFile, new TextEncoder().encode(stringifyAssetJson(tree))],
    [
      namedFile,
      new TextEncoder().encode(
        stringifyAssetJson(normalizeActorBin(tree, names)),
      ),
    ],
  ]) {
    await Bun.write(path.join(out, target), bytes);
    files.push({ file: target, bytes: bytes.length, sha256: sha(bytes) });
  }
  records.push({
    wad,
    file,
    rawFile,
    typedFile,
    namedFile,
    sourceSha256: sha(raw),
    dependencies: tree.dependencies,
    objects: tree.objects.map((object) => ({
      pathHash: object.pathHash,
      classHash: object.classHash,
    })),
  });
}
for (const [file, digest] of Object.entries(tools))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error("Original shader declaration compiler changed");
for (const file of files) {
  const bytes = await Bun.file(path.join(out, file.file)).bytes();
  if (bytes.length !== file.bytes || sha(bytes) !== file.sha256)
    throw Error("Original shader declaration readback differs");
}
const manifest = {
  schema: 1,
  kind: "archived-original-shader-global-declarations",
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  records,
  files,
  tools,
  toolchain: source.toolchain,
  provenance: source.provenance(),
  rmanReceipts: source.receipts(),
  scope: {
    originalSourceBytes: true,
    completeOriginalRootFields: true,
    nativeTypedReaderExecuted: false,
    globalRegistryInitialized: false,
    resourceAcquisition: false,
    nativeRendererAdmitted: false,
  },
};
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(manifest));
console.log(
  JSON.stringify({
    output: out,
    originalBins: records.length,
    sources: records.map((row) => ({
      file: row.file,
      sha256: row.sourceSha256,
    })),
    nativeRendererAdmitted: false,
  }),
);
