// Publish inspected complete-parent component evidence; no viewer claims.
import { resolve } from "node:path";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: publish-parent-frames.mjs <cache>");
const cache = resolve(arg),
  assets = `${cache}/public`,
  directory = `${assets}/latest-parent-frame-caches`,
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  nativeBytes = await raw(`${cache}/research/parent-frames-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  proofBytes = await raw(`${cache}/research/parent-frames-inspection.json`),
  proof = JSON.parse(new TextDecoder().decode(proofBytes)),
  packageBytes = await raw(`${directory}/package.json`),
  prepared = JSON.parse(new TextDecoder().decode(packageBytes)),
  visualBytes = await raw(`${assets}/evidence/latest-parent-frames.json`),
  visual = JSON.parse(new TextDecoder().decode(visualBytes));
check(
  native.kind === "complete-native-parent-frame-observations" &&
    native.build === "16.21.829.8620" &&
    native.protocol === "20e09df23c66b85e" &&
    native.scope.partialCorpus &&
    native.scope.originalParentActivationAndTick &&
    native.scope.originalObjectSuspensionPropagation &&
    !native.scope.wasmCompared &&
    !native.scope.browserRun &&
    !native.scope.mainViewerIntegrated &&
    !native.scope.referenceCompared &&
    proof.observationSha256 === sha(nativeBytes) &&
    proof.mismatchCount === 0 &&
    proof.checks.roots === 10 &&
    proof.checks.frames === 600 &&
    proof.checks.geometryRecords === 3300 &&
    proof.checks.checkpointContinuationFrames === 480 &&
    proof.checks.checkpointCpuWorldComparisons === 10 &&
    proof.checks.invalidCheckpointRejections === 20 &&
    proof.cachePackageSha256 === sha(packageBytes) &&
    prepared.observationSha256 === sha(nativeBytes) &&
    prepared.caches.length === 10 &&
    !prepared.scope.portableBrowserGraphicsHandles &&
    visual.observationSha256 === sha(nativeBytes) &&
    visual.inspectionSha256 === sha(proofBytes) &&
    visual.counts.panels === 10 &&
    visual.counts.draws === visual.draws.length &&
    visual.scope.completeParentNativeGeometry &&
    visual.scope.sceneInputsAndPassOrderSupplied &&
    !visual.scope.fullNativeMaterialFrameBindings &&
    !visual.scope.matchReplayFrame &&
    !visual.scope.browserExecuted &&
    !visual.scope.referenceCompared,
  "Incomplete or overstated parent frame/seek/visual evidence",
);
for (const [name, digest] of Object.entries(native.sources))
  check(
    sha(await raw(resolve(import.meta.dir, name))) === digest,
    `Parent producer source changed: ${name}`,
  );
for (const [path, digest] of Object.entries(native.inputs))
  check(sha(await raw(path)) === digest, `Parent input changed: ${path}`);
for (const [path, digest] of Object.entries(visual.inputs))
  check(
    sha(await raw(path)) === digest,
    `Parent visual input changed: ${path}`,
  );
check(
  sha(await raw(resolve(import.meta.dir, "inspect-parent-frames.py"))) ===
    proof.inspectorSha256,
  "Parent inspector changed",
);
check(
  sha(await raw(resolve(import.meta.dir, "render-parent-frames.py"))) ===
    visual.rendererSha256,
  "Parent visual renderer changed",
);
check(
  sha(await raw(`${cache}/research/vfx-cubemaps-native.json`)) ===
    proof.baselineObservationSha256,
  "Parent authored-heap baseline changed",
);
const image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
check(
  sha(image) === native.decoderImageSha256,
  "Parent executable image changed",
);
for (const block of native.originalBlocks)
  check(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Parent executed native code changed",
  );
for (const draw of visual.draws) {
  const c = native.cases.find((c) => c.effectId === draw.effectId),
    f = c.frames.find((f) => f.tick === draw.tick),
    g = f.geometry.find((g) => g.emitterIndex === draw.emitterIndex);
  check(
    sha(Buffer.from(g.verticesHex, "hex")) === draw.verticesSha256 &&
      sha(Buffer.from(g.indicesHex, "hex")) === draw.indicesSha256,
    "Parent visual drew different native geometry",
  );
}
const files = new Map();
async function add(url, path, expected) {
  const bytes = await raw(path),
    digest = sha(bytes);
  check(
    !expected || digest === expected,
    `Parent publication bytes differ: ${path}`,
  );
  const previous = files.get(url);
  check(
    !previous || previous.sha256 === digest,
    "Parent publication URL collides",
  );
  files.set(url, { path, sha256: digest });
}
await add(
  "/assets/latest-parent-frame-caches/package.json",
  `${directory}/package.json`,
  sha(packageBytes),
);
for (const ref of prepared.caches) {
  const bytes = await raw(`${directory}/${ref.file}`),
    metadata = JSON.parse(new TextDecoder().decode(bytes));
  check(
    sha(bytes) === ref.sha256 &&
      metadata.effectId === ref.effectId &&
      metadata.scope.staticAuthoredAssetInitialization &&
      !metadata.scope.containsReplayEvents &&
      !metadata.scope.portableBrowserGraphicsHandles,
    "Parent static cache identity/scope differs",
  );
  await add(
    `/assets/latest-parent-frame-caches/${ref.file}`,
    `${directory}/${ref.file}`,
    ref.sha256,
  );
  for (const region of [...metadata.segments, ...metadata.imagePatches])
    await add(
      `/assets/latest-parent-frame-caches/${region.file}`,
      `${directory}/${region.file}`,
      region.sha256,
    );
}
const compressed = Bun.gzipSync(nativeBytes);
check(
  sha(Bun.gunzipSync(compressed)) === sha(nativeBytes),
  "Compressed parent observation differs",
);
for (const [name, bytes] of [
  ["latest-parent-frames-native.json.gz", compressed],
  ["latest-parent-frames-inspection.json", proofBytes],
]) {
  const path = `${assets}/evidence/${name}`;
  await Bun.write(path, bytes);
  await add(`/assets/evidence/${name}`, path, sha(bytes));
}
await add(
  "/assets/evidence/latest-parent-frames.png",
  `${assets}/evidence/latest-parent-frames.png`,
  visual.imageSha256,
);
// The visual summary has its own URL; never overwrite it with the observation.
await add(
  "/assets/evidence/latest-parent-frames.json",
  `${assets}/evidence/latest-parent-frames.json`,
  sha(visualBytes),
);
let httpChecks = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
])
  for (const [url, ref] of files) {
    const response = await fetch(base + url, {
      signal: AbortSignal.timeout(30000),
    });
    check(
      response.status === 200 &&
        sha(new Uint8Array(await response.arrayBuffer())) === ref.sha256,
      `Parent evidence HTTP bytes differ: ${base + url}`,
    );
    httpChecks++;
  }
check(
  sha(await raw(`${assets}/evidence/latest-parent-frames.json`)) ===
    sha(visualBytes),
  "Parent publication changed the visual summary",
);
const result = {
  schema: 1,
  kind: "complete-parent-frame-evidence-publication",
  observationSha256: sha(nativeBytes),
  inspectionSha256: sha(proofBytes),
  visualSha256: sha(visualBytes),
  cachePackageSha256: sha(packageBytes),
  httpChecks,
  files: Object.fromEntries(files),
  counts: native.counts,
  inspectionChecks: proof.checks,
  scope: native.scope,
  publisherSha256: sha(await raw(import.meta.path)),
};
await Bun.write(
  `${cache}/research/parent-frames-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    httpChecks,
    files: files.size,
    counts: native.counts,
    imageSha256: visual.imageSha256,
  }),
);
