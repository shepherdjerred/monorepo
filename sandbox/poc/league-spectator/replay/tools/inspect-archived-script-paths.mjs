// Fetch only filenames returned by the executed original registry lookup.
import path from "node:path";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import {
  openArchivedActorSources,
  actorSha256 as sha,
} from "./archived-actor-sources.mjs";
const [parserArg, sourceArg, cacheArg, proofArg, registryRootArg] =
  process.argv.slice(2);
if (!registryRootArg)
  throw Error(
    "Usage: bun inspect-archived-script-paths.mjs <RMAN-parser> <approved-cache> <archive-cache> <native-script-registry-proof.json> <script-registry-input-root>",
  );
const proofBytes = await Bun.file(proofArg).bytes(),
  proof = JSON.parse(new TextDecoder().decode(proofBytes)),
  registryBytes = await Bun.file(
    path.join(registryRootArg, "manifest.json"),
  ).bytes(),
  registry = JSON.parse(new TextDecoder().decode(registryBytes));
if (
  proof.schema !== 1 ||
  proof.kind !== "original-archived-script-registry-observation" ||
  proof.build !== "16.21.829.8620" ||
  proof.protocol !== "20e09df23c66b85e" ||
  proof.decoderImageSha256 !==
    "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7" ||
  proof.boundary !== null ||
  proof.scope.originalManifestParsingExecuted !== true ||
  proof.scope.ownedArchivedByteStream !== true ||
  proof.scope.pathQueriesStoppedBeforeArchiveLookup !== true ||
  proof.sourceAuthoritySha256 !== sha(registryBytes) ||
  registry.kind !== "archived-original-script-registry-input-candidates" ||
  registry.requestedNamespace !== "DATA/all_lua_files.manifest"
)
  throw Error(
    "Matching original executed script-registry source proof required",
  );
const inputs = new Map([
  [path.resolve(proofArg), sha(proofBytes)],
  [path.resolve(registryRootArg, "manifest.json"), sha(registryBytes)],
]);
for (const [file, digest] of Object.entries(proof.sources)) {
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Original script-registry producer changed");
  inputs.set(path.resolve(file), digest);
}
const sourceFiles = registry.files.filter(
  (row) => row.sha256 === proof.sourceBytesSha256,
);
if (sourceFiles.length !== 1)
  throw Error("Unique original parsed script manifest required");
const originalFile = path.resolve(registryRootArg, sourceFiles[0].file),
  original = await Bun.file(originalFile).bytes();
if (
  original.length !== sourceFiles[0].bytes ||
  sha(original) !== proof.sourceBytesSha256
)
  throw Error("Original parsed script manifest bytes differ");
inputs.set(originalFile, sha(original));
const requests = [],
  unavailable = [],
  seen = new Set();
for (const query of proof.pathQueries) {
  if (query.originalReturnedValue === false) {
    if (query.constructedPath !== null)
      throw Error("Unavailable script lookup has a path");
    unavailable.push({ name: query.name, ownerPathHash: query.ownerPathHash });
    continue;
  }
  if (
    query.originalReturnedValue !== true ||
    !/^DATA\/Spells\/[A-Za-z0-9_]+\.luabin64$/.test(query.constructedPath) ||
    query.archiveExistenceObserved !== false ||
    !Array.isArray(query.matchingPackedValuesHex) ||
    query.matchingPackedValuesHex.length !== 1
  )
    throw Error("Bounded original script lookup result required");
  if (seen.has(query.constructedPath))
    throw Error("Duplicate original script path request");
  seen.add(query.constructedPath);
  requests.push({
    name: query.name,
    ownerPathHash: query.ownerPathHash,
    sourceBinSha256: query.sourceSha256,
    path: query.constructedPath,
    nativeNameHashHex: query.nativeNameHashHex,
  });
}
if (!requests.length || requests.length > 1024)
  throw Error("Bounded nonempty original script request list required");
const { sourceCache, cache, out } = await createStaticPreparationOutput(
  sourceArg,
  cacheArg,
  { prefix: "script-paths-", directory: "script-paths" },
);
const source = await openArchivedActorSources({
    parserCheckout: parserArg,
    sourceCache,
    archiveCache: cache,
  }),
  records = [],
  files = [],
  tools = {};
for (const name of [
  "inspect-archived-script-paths.mjs",
  "archived-actor-sources.mjs",
  "rman-chunks.mjs",
  "wad.mjs",
  "map-scene-output.mjs",
])
  tools[name] = sha(await Bun.file(new URL(name, import.meta.url)).bytes());
for (const wad of [
  "DATA/FINAL/Scripts.wad.client",
  "DATA/FINAL/DATA.wad.client",
  "DATA/FINAL/Global.wad.client",
  "DATA/FINAL/Bootstrap.windows.wad.client",
]) {
  const archive = await source.wad(wad);
  for (const request of requests) {
    if (!archive.has(request.path)) {
      records.push({ ...request, wad, present: false });
      continue;
    }
    const bytes = await source.read(wad, request.path),
      file = `script-${files.length}.bin`;
    await Bun.write(path.join(out, file), bytes);
    const item = { file, bytes: bytes.length, sha256: sha(bytes) };
    files.push(item);
    records.push({ ...request, wad, present: true, ...item });
  }
}
for (const [file, digest] of inputs)
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Original script lookup input changed");
for (const [file, digest] of Object.entries(tools))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error("Original script extraction source changed");
for (const file of files) {
  const bytes = await Bun.file(path.join(out, file.file)).bytes();
  if (bytes.length !== file.bytes || sha(bytes) !== file.sha256)
    throw Error("Original script readback differs");
}
const manifest = {
  schema: 1,
  kind: "archived-original-native-selected-scripts",
  build: proof.build,
  protocol: proof.protocol,
  proofSha256: sha(proofBytes),
  sourceRegistrySha256: sha(registryBytes),
  inputs: Object.fromEntries(inputs),
  tools,
  requests,
  unavailable,
  records,
  files,
  provenance: source.provenance(),
  rmanReceipts: source.receipts(),
  scope: {
    onlyOriginalReturnedPaths: true,
    allExplicitOwnersRetained: true,
    archivePrecedenceAdmitted: false,
    scriptsExecuted: false,
    runtimeSpellResourcesPublished: false,
  },
};
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(manifest));
console.log(
  JSON.stringify({
    output: out,
    requests: requests.length,
    unavailable: unavailable.length,
    owners: records.filter((row) => row.present),
    runtimeSpellResourcesPublished: false,
  }),
);
