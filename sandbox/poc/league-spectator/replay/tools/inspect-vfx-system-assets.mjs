// Complete static asset closure/provenance; this does not run the runtime factory.
import { resolve } from "node:path";
import {
  createLatestVfxSystemAssetInventory,
  VFX_SYSTEM_ASSETS_PACKAGE_SHA,
} from "../latest-vfx-system-assets.mjs";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: inspect-vfx-system-assets.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  decoder = `${cache}/public/decoder-16.21-macos`,
  assets = `${cache}/public/latest-vfx-system-assets`,
  effects = `${cache}/public/latest-effects`,
  inputs = {};
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  raw = async (path) => {
    const value = new Uint8Array(await Bun.file(path).arrayBuffer());
    inputs[path] = sha(value);
    return value;
  },
  json = async (path) => JSON.parse(new TextDecoder().decode(await raw(path)));
const requireThat = (ok, message) => {
  if (!ok) throw Error(message);
};
const nativePath = `${cache}/research/vfx-system-assets-native.json`,
  native = await json(nativePath),
  profile = await json(`${decoder}/profile.json`),
  image = await raw(`${decoder}/image.bin`),
  packageBytes = await raw(`${assets}/package.json`),
  nativeAssetBytes = await raw(`${decoder}/vfx-assets.json`),
  effectsBytes = await raw(`${effects}/manifest.json`),
  effectManifest = JSON.parse(new TextDecoder().decode(effectsBytes));
requireThat(
  sha(packageBytes) === native.packageSha256 &&
    native.packageSha256 === VFX_SYSTEM_ASSETS_PACKAGE_SHA &&
    sha(image) === profile.decoderImageSha256 &&
    native.counts.systems === Object.keys(effectManifest.definitions).length,
  "Complete-system asset package changed",
);
for (const [name, expected] of Object.entries(native.sources))
  requireThat(
    sha(await raw(`${root}/tools/${name}`)) === expected,
    `Stale native system source: ${name}`,
  );
for (const [path, expected] of Object.entries(native.inputs))
  requireThat(
    sha(await raw(path)) === expected,
    `Stale native system input: ${path}`,
  );
for (const block of native.originalBlocks)
  requireThat(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Complete-system original code changed",
  );
const inventory = await createLatestVfxSystemAssetInventory(
    profile,
    packageBytes,
    effectsBytes,
    nativeAssetBytes,
  ),
  rows = [],
  rawSources = new Map(),
  requestProof = await json(
    `${cache}/research/effect-creation-comparison.json`,
  ),
  counts = {
    systems: 0,
    serializedFields: 0,
    objectVisits: 0,
    callbackVisits: 0,
    directComplexEmitters: 0,
    directSimpleEmitters: 0,
    emitterDefinitionVisits: 0,
    heapBytes: 0,
    nativeIgnoredFields: 0,
    nativeTypeMismatches: 0,
    pendingLinkFixups: 0,
    mathCalls: 0,
    replayPreparedResources: 0,
  };
for (const [effectId, effectRef] of Object.entries(
  effectManifest.definitions,
)) {
  const ref = inventory.inspectSystem(effectId),
    effectBytes = await raw(`${effects}/${effectRef.file}`),
    state = await inventory.bindSystem(
      effectId,
      effectBytes,
      await raw(`${assets}/${ref.file}`),
    ),
    sourcePath = `${cache}/research/latest-effects/bins/${ref.rawSourceSha256}-${effectManifest.toolchain.parserIdentity.slice(0, 16)}.bin`;
  if (!rawSources.has(sourcePath))
    rawSources.set(sourcePath, await raw(sourcePath));
  const source = rawSources.get(sourcePath);
  requireThat(
    sha(source) === ref.rawSourceSha256,
    "Raw system BIN source changed",
  );
  for (const field of ref.fields)
    requireThat(
      field.offset >= 0 &&
        field.bytes > 0 &&
        field.offset + field.bytes <= source.length &&
        sha(source.subarray(field.offset, field.offset + field.bytes)) ===
          field.sha256,
      "Serialized system field provenance differs",
    );
  const visitedComplex = state.visits.filter(
      (visit) => visit.type === 0x09cde442,
    ).length,
    callbacks = state.visits.filter(
      (visit) => visit.callbackRva !== null,
    ).length;
  counts.systems++;
  counts.serializedFields += ref.fields.length;
  counts.objectVisits += state.visits.length;
  counts.callbackVisits += callbacks;
  counts.directComplexEmitters += state.complexEmitters.length;
  counts.directSimpleEmitters += state.simpleEmitters.length;
  counts.emitterDefinitionVisits += visitedComplex;
  counts.heapBytes += state.heap.length;
  counts.nativeIgnoredFields += ref.nativeIgnoredFields.length;
  counts.nativeTypeMismatches += ref.nativeTypeMismatches.length;
  counts.pendingLinkFixups += ref.pendingLinkFixups;
  rows.push({
    effectId,
    definitionSha256: ref.definitionSha256,
    graphSha256: ref.sha256,
    rootSha256: ref.rootSha256,
    heapSha256: ref.heapSha256,
    heapBytes: state.heap.length,
    serializedFields: ref.fields.length,
    visits: state.visits.length,
    callbacks,
    directComplexEmitters: state.complexEmitters.length,
    directSimpleEmitters: state.simpleEmitters.length,
    emitterDefinitionVisits: visitedComplex,
  });
}
for (const binding of requestProof.bindings)
  if (binding.status === "prepared-context-resource") {
    requireThat(
      inventory.inspectSystem(binding.effectId).definitionSha256 ===
        effectManifest.definitions[binding.effectId].sha256,
      "Replay prepared resource lacks a complete authored root",
    );
    counts.replayPreparedResources++;
  }
for (const [key, value] of Object.entries({
  systems: native.counts.systems,
  serializedFields: native.counts.serializedFields,
  objectVisits: native.counts.objectVisits,
  callbackVisits: native.counts.callbackVisits,
  directComplexEmitters: native.counts.directComplexEmitters,
  directSimpleEmitters: native.counts.directSimpleEmitters,
  emitterDefinitionVisits: native.counts.emitterDefinitionVisits,
  nativeIgnoredFields: native.counts.nativeIgnoredFields,
  nativeTypeMismatches: native.counts.nativeTypeMismatches,
  pendingLinkFixups: native.counts.pendingLinkFixups,
  mathCalls: native.counts.mathCalls,
}))
  requireThat(
    counts[key] === value,
    `Complete-system native count differs: ${key}`,
  );
requireThat(
  counts.replayPreparedResources ===
    requestProof.counts.bindingCounts["prepared-context-resource"],
  "Replay root coverage differs",
);
const sources = {};
for (const name of [
  "latest-vfx-system-assets.mjs",
  "latest-vfx-assets.mjs",
  "structural-comparison.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "complete-system-asset-comparison",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  packageSha256: VFX_SYSTEM_ASSETS_PACKAGE_SHA,
  nativeEvidenceSha256: inputs[nativePath],
  inspectorSha256: sha(await raw(import.meta.path)),
  sources,
  inputs,
  counts,
  rows,
  mismatches: [],
  scope: {
    completeSerializedRoot: true,
    originalPostloadCallbacks: true,
    allPreparedDefinitionsCovered: true,
    parentOverridesPreserved: true,
    browserCompatibleInventory: true,
    runtimeFactoryExecuted: false,
    resourceAcquisitionExecuted: false,
    mainViewerIntegrated: false,
    browserRun: false,
    leagueReferenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/vfx-system-assets-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(counts));
