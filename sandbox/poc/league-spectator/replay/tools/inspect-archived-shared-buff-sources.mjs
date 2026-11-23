// Probe explicit original global namespaces in the archived release. A source
// match is not registry selection, an ELF collision winner or buff activation.
import path from "node:path";
import { pathToFileURL } from "node:url";
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
import { MAP11_RELEASE_SHA256 } from "./map-scene-assets.mjs";

const [parserArg, sourceArg, cacheArg, requestArg] = process.argv.slice(2);
if (!requestArg)
  throw Error(
    "Usage: bun inspect-archived-shared-buff-sources.mjs <pinned-RMAN-parser> <approved-cache> <archive-cache> <recorded-buff-requests.json>",
  );
const { sourceCache, cache, out } = await createStaticPreparationOutput(
  sourceArg,
  cacheArg,
  { prefix: "buff-shared-sources-", directory: "buff-shared-sources" },
);
const requestBytes = await Bun.file(requestArg).bytes(),
  request = JSON.parse(new TextDecoder().decode(requestBytes));
if (
  request.kind !== "recorded-buff-resource-requests" ||
  request.build !== "16.21.829.8620" ||
  request.protocol !== "20e09df23c66b85e"
)
  throw Error("Exact recorded original buff requests required");
const source = await openArchivedActorSources({
  parserCheckout: parserArg,
  sourceCache,
  archiveCache: cache,
});
const release = await Bun.file(path.join(cache, "release.manifest")).bytes();
if (sha(release) !== MAP11_RELEASE_SHA256)
  throw Error("Original archived release changed");
const parserPath = path.resolve(parserArg, "src/rman.js"),
  parserBytes = await Bun.file(parserPath).bytes(),
  { parseRman } = await import(pathToFileURL(parserPath).href),
  manifest = parseRman(release),
  releaseFiles = new Set(manifest.files.map((file) => file.name.toLowerCase()));
const sourceNames = [
    "inspect-archived-shared-buff-sources.mjs",
    "archived-actor-sources.mjs",
    "archived-actor-bin.mjs",
    "exact-map-bin.mjs",
    "wad.mjs",
    "rman-chunks.mjs",
    "map-scene-assets.mjs",
    "map-scene-output.mjs",
    "asset-json.mjs",
  ],
  tools = {};
for (const name of sourceNames)
  tools[name] = sha(await Bun.file(new URL(name, import.meta.url)).bytes());
const names = readActorMetaNames(
  await Bun.file(
    path.join(
      sourceCache,
      "research/LeagueToolkit/src/LeagueToolkit.Meta.Classes/Classes.cs",
    ),
  ).text(),
);
const archives = [
    "DATA/FINAL/Global.wad.client",
    "DATA/FINAL/DATA.wad.client",
    "DATA/FINAL/Scripts.wad.client",
    "DATA/FINAL/Maps/Shipping/Common.wad.client",
    "DATA/FINAL/Maps/Shipping/Map11.wad.client",
    "DATA/FINAL/Bootstrap.windows.wad.client",
  ],
  seeds = [
    "shared",
    "data/shared/shared.bin",
    "globals",
    "data/globals/globals.bin",
  ],
  records = [],
  files = [],
  queue = [],
  seen = new Set();
for (const wad of archives) {
  if (!releaseFiles.has(wad.toLowerCase())) {
    records.push({ wad, status: "archive-not-in-release" });
    continue;
  }
  const archive = await source.wad(wad);
  for (const file of seeds) {
    const present = archive.has(file);
    records.push({
      wad,
      file,
      present,
      role: "explicit-global-source-candidate",
    });
    if (present)
      queue.push({
        wad,
        file,
        requestedBy: "explicit-global-source-candidate",
      });
  }
}
for (let at = 0; at < queue.length; at++) {
  if (queue.length > 10000)
    throw Error("Original Shared dependency closure exceeds bound");
  const row = queue[at],
    key = `${row.wad.toLowerCase()}:${row.file.toLowerCase()}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const raw = await source.read(row.wad, row.file),
    tree = readExactMapBin(raw, request.build, { captureFieldSpans: true }),
    index = records.filter((record) => record.sourceSha256).length;
  const rawFile = `bin-${index}.bin`,
    typedFile = `bin-${index}.typed.json`,
    namedFile = `bin-${index}.json`;
  for (const [file, bytes] of [
    [rawFile, raw],
    [typedFile, new TextEncoder().encode(stringifyAssetJson(tree))],
    [
      namedFile,
      new TextEncoder().encode(
        stringifyAssetJson(normalizeActorBin(tree, names)),
      ),
    ],
  ]) {
    await Bun.write(path.join(out, file), bytes);
    files.push({ file, bytes: bytes.length, sha256: sha(bytes) });
  }
  records.push({
    ...row,
    sourceSha256: sha(raw),
    rawFile,
    typedFile,
    namedFile,
    objects: tree.objects.map((node) => ({
      pathHash: node.pathHash,
      classHash: node.classHash,
    })),
    dependencies: tree.dependencies,
  });
  for (const file of tree.dependencies) {
    if (typeof file !== "string")
      throw Error("Original Shared dependency path required");
    const matches = [];
    for (const wad of archives)
      if (
        releaseFiles.has(wad.toLowerCase()) &&
        (await source.wad(wad)).has(file)
      )
        matches.push(wad);
    if (!matches.length)
      records.push({
        file,
        requestedBy: key,
        status: "dependency-absent-from-explicit-archives",
      });
    else for (const wad of matches) queue.push({ wad, file, requestedBy: key });
  }
}
for (const name of sourceNames)
  if (
    sha(await Bun.file(new URL(name, import.meta.url)).bytes()) !== tools[name]
  )
    throw Error("Shared source compiler changed during run");
if (
  sha(await Bun.file(parserPath).bytes()) !== sha(parserBytes) ||
  sha(await Bun.file(requestArg).bytes()) !== sha(requestBytes)
)
  throw Error("Shared source request/parser changed");
for (const file of files) {
  const bytes = await Bun.file(path.join(out, file.file)).bytes();
  if (bytes.length !== file.bytes || sha(bytes) !== file.sha256)
    throw Error("Shared output readback changed");
}
const result = {
  schema: 1,
  kind: "archived-original-shared-buff-source-candidates",
  build: request.build,
  protocol: request.protocol,
  requestSha256: sha(requestBytes),
  releaseManifestSha256: sha(release),
  parserSha256: sha(parserBytes),
  tools,
  records,
  files,
  provenance: source.provenance(),
  rmanReceipts: source.receipts(),
  scope: {
    completeOriginalObjectsRetained: true,
    onlyExplicitArchiveCandidates: true,
    nativeResourceRegistryLookup: false,
    collisionWinner: false,
    buffActivation: false,
  },
  nativeSpectatorAdmitted: false,
};
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(result));
console.log(
  JSON.stringify({
    output: out,
    sourceBins: seen.size,
    sourceCandidates: records.length,
    nativeSpectatorAdmitted: false,
  }),
);
