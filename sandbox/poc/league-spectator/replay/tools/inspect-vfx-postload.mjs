import { resolve } from "node:path";
import { createLatestVfxPostloadInventory } from "../latest-vfx-postload.mjs";

const [packagePath, effectsPath, nativePath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-vfx-postload.mjs <decoder> <effects> <native> <comparison>",
  );
const root = resolve(packagePath),
  effects = resolve(effectsPath),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  profile = await Bun.file(`${root}/profile.json`).json(),
  metaRaw = await Bun.file(`${root}/vfx-postload.json`).arrayBuffer(),
  meta = JSON.parse(new TextDecoder().decode(metaRaw)),
  assetsRaw = await Bun.file(`${root}/vfx-assets.json`).arrayBuffer(),
  assets = JSON.parse(new TextDecoder().decode(assetsRaw)),
  nativeRaw = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeRaw)),
  image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
  manifestRaw = await Bun.file(`${effects}/manifest.json`).arrayBuffer(),
  manifest = JSON.parse(new TextDecoder().decode(manifestRaw)),
  factory = await createLatestVfxPostloadInventory(profile, metaRaw, assetsRaw);
if (
  native.definitionSha256 !== hash(metaRaw) ||
  native.build !== meta.build ||
  native.protocol !== meta.protocol ||
  hash(image) !== meta.decoderImageSha256 ||
  hash(manifestRaw) !== meta.effectsManifestSha256 ||
  Object.keys(meta.emitters).length !== Object.keys(assets.emitters).length
)
  throw Error("Post-load evidence inputs disagree");
for (const [name, digest] of Object.entries(meta.compilerSources))
  if (
    native.compilerSources[name] !== digest ||
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
      digest
  )
    throw Error(`Stale post-load compiler ${name}`);
for (const block of native.originalBlocks)
  if (hash(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
    throw Error("Original post-load code changed");
const originalBlocks = new Map(native.originalBlocks.map((b) => [b.rva, b])),
  postloadBlocks = new Set(native.postloadOriginalBlocks.map((b) => b.rva));
for (const block of native.postloadOriginalBlocks)
  if (JSON.stringify(block) !== JSON.stringify(originalBlocks.get(block.rva)))
    throw Error("Post-load block missing from original execution audit");
const observations = new Map(native.observations.map((o) => [o.key, o])),
  definitions = new Map(),
  visitedTypes = {},
  actors = {},
  counts = {
    emitters: 0,
    objectVisits: 0,
    callbackVisits: 0,
    changedBytes: 0,
    changedEmitters: 0,
    mathCalls: 0,
    pendingLinkFixups: 0,
  };
let addedHeapBytes = 0,
  allocatingEmitters = 0,
  graphBytes = 0;
for (const [key, ref] of Object.entries(meta.emitters)) {
  const serialized = assets.emitters[key],
    observation = observations.get(key);
  if (!serialized || !observation)
    throw Error("Missing post-load emitter source");
  if (!definitions.has(ref.effectId))
    definitions.set(
      ref.effectId,
      await Bun.file(
        `${effects}/${manifest.definitions[ref.effectId].file}`,
      ).arrayBuffer(),
    );
  const beforeRaw = await Bun.file(`${root}/${serialized.file}`).arrayBuffer(),
    before = JSON.parse(new TextDecoder().decode(beforeRaw)),
    raw = await Bun.file(`${root}/${ref.file}`).arrayBuffer(),
    state = await factory.bindEmitter(
      ref.effectId,
      ref.emitterIndex,
      definitions.get(ref.effectId),
      beforeRaw,
      raw,
    ),
    beforeObject = Buffer.from(before.objectHex, "hex"),
    beforeHeap = Buffer.from(before.heapHex, "hex");
  if (
    observation.sha256 !== hash(raw) ||
    observation.objectSha256 !== hash(state.object) ||
    observation.heapSha256 !== hash(state.heap) ||
    observation.beforeObjectSha256 !== hash(beforeObject) ||
    observation.beforeHeapSha256 !== hash(beforeHeap)
  )
    throw Error("Post-load native before/after observation changed");
  counts.emitters++;
  counts.changedBytes += state.changedBytes;
  counts.changedEmitters += state.changedBytes !== 0;
  counts.objectVisits += state.visits.length;
  counts.pendingLinkFixups += state.pendingLinkFixups;
  addedHeapBytes += state.addedHeapBytes;
  allocatingEmitters += state.addedHeapBytes !== 0;
  graphBytes += raw.byteLength;
  const actor = ref.effectId.split("/").slice(0, 3).join("/");
  actors[actor] ??= { emitters: 0, callbacks: 0 };
  actors[actor].emitters++;
  for (const visit of state.visits) {
    const type = visit.type.toString(16).padStart(8, "0");
    visitedTypes[type] = (visitedTypes[type] ?? 0) + 1;
    if (visit.callbackRva !== null) {
      if (!postloadBlocks.has(visit.callbackRva))
        throw Error("Class callback missing from original block audit");
      counts.callbackVisits++;
      actors[actor].callbacks++;
    }
  }
}
for (const [name, count] of Object.entries(counts))
  if (meta.summary[name] !== count || native.summary[name] !== count)
    throw Error(`Incomplete post-load coverage: ${name}`);
if (
  observations.size !== counts.emitters ||
  meta.repeatedLoads !== native.repeatedLoads ||
  Object.keys(visitedTypes).length !== Object.keys(meta.visitedTypes).length ||
  Object.entries(visitedTypes).some(
    ([type, count]) => meta.visitedTypes[type] !== count,
  )
)
  throw Error("Incomplete post-load observation/type inventory");
const result = {
  schema: 1,
  build: meta.build,
  protocol: meta.protocol,
  definitionSha256: hash(metaRaw),
  assetDefinitionSha256: hash(assetsRaw),
  nativeEvidenceSha256: hash(nativeRaw),
  moduleSha256: hash(
    await Bun.file(
      new URL("../latest-vfx-postload.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  ...counts,
  visitedTypes: Object.keys(visitedTypes).length,
  repeatedLoads: native.repeatedLoads,
  allocatingEmitters,
  addedHeapBytes,
  graphBytes,
  postloadOriginalBlocks: postloadBlocks.size,
  uniqueGraphs: new Set(Object.values(meta.emitters).map((r) => r.sha256)).size,
  actors,
  mismatchCount: 0,
  scope: meta.scope,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
