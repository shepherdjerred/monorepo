// Publish exact-build ray CPU resources to the existing private preview. GPU
// handles in warmed caches are metadata; no main-viewer effect is enabled here.
import { resolve } from "node:path";
import { PARENT_RAY_CACHES_SHA } from "../latest-parent-frames.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  directory = `${assets}/latest-ray-parent-caches`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[resolve(p)] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  nativePath = `${cache}/research/ray-parent-frames-native.json`,
  native = await read(nativePath),
  comparisonPath = `${cache}/research/ray-parent-frames-comparison.json`,
  comparison = await read(comparisonPath),
  workerPath = `${cache}/research/ray-parent-workers-comparison.json`,
  worker = await read(workerPath),
  catalog = await read(`${directory}/package.json`),
  files = new Map();
check(
  catalog.kind === "prepared-ray-parent-resource-caches" &&
    catalog.build === "16.21.829.8620" &&
    catalog.protocol === "20e09df23c66b85e" &&
    inputs[resolve(`${directory}/package.json`)] === PARENT_RAY_CACHES_SHA &&
    catalog.observationSha256 === inputs[resolve(nativePath)] &&
    catalog.caches.length === 14 &&
    native.counts.returningRoots === 14 &&
    !native.scope.partialSelection &&
    !catalog.scope.containsReplayEvents &&
    !catalog.scope.portableBrowserGraphicsHandles,
  "Exact-build complete native ray cache cohort required",
);
check(
  comparison.mismatchCount === 0 &&
    comparison.observationSha256 === inputs[resolve(nativePath)] &&
    comparison.cachePackageSha256 === PARENT_RAY_CACHES_SHA &&
    comparison.counts.forwardFrames === 420 &&
    comparison.counts.restoredFrames === 210 &&
    comparison.counts.worldRestorations === 14 &&
    comparison.counts.geometryRecords === 3735 &&
    comparison.counts.geometryAttributeRecords === 3735 &&
    comparison.scope.allPreparedRootsCompared &&
    comparison.scope.renderAttributeParserExecuted &&
    !comparison.scope.materialBridgeExecuted &&
    !comparison.scope.browserExecuted,
  "Complete ray native/WASM state/geometry comparison required",
);
check(
  worker.mismatchCount === 0 &&
    worker.observationSha256 === inputs[resolve(nativePath)] &&
    worker.comparisonSha256 === inputs[resolve(comparisonPath)] &&
    worker.counts.roots === 14 &&
    worker.counts.forwardFrames === 420 &&
    worker.counts.restoredFrames === 210 &&
    worker.counts.exportIsolationChecks === 14 &&
    worker.counts.worldRestorations === 14 &&
    worker.scope.realModuleWorkers &&
    worker.scope.staticHttpResources &&
    worker.scope.browserBundlesBuilt &&
    !worker.scope.mainViewerEnabled &&
    !worker.scope.browserExecuted,
  "Complete isolated ray worker comparison required",
);
for (const [proof, base] of [
  [native, `${root}/tools`],
  [comparison, root],
  [worker, root],
]) {
  for (const [name, digest] of Object.entries(proof.sources))
    check(
      sha(await raw(`${base}/${name}`)) === digest,
      `Ray source changed: ${name}`,
    );
  for (const [path, digest] of Object.entries(proof.inputs))
    check(sha(await raw(path)) === digest, `Ray input changed: ${path}`);
}
async function add(url, path, digest) {
  const bytes = await raw(path);
  check(sha(bytes) === digest, `Ray publication bytes differ: ${url}`);
  check(
    !files.has(url) || files.get(url).sha256 === digest,
    "Conflicting ray publication URL",
  );
  files.set(url, { path, sha256: digest, bytes: bytes.length });
}
await add(
  "/assets/latest-ray-parent-caches/package.json",
  `${directory}/package.json`,
  PARENT_RAY_CACHES_SHA,
);
for (const ref of catalog.caches) {
  const path = `${directory}/${ref.file}`,
    record = await read(path);
  check(
    record.effectId === ref.effectId &&
      record.scope.warmParentSuspended &&
      !record.scope.containsReplayEvents &&
      !record.scope.portableBrowserGraphicsHandles,
    "Ray cache identity/scope differs",
  );
  await add(`/assets/latest-ray-parent-caches/${ref.file}`, path, ref.sha256);
  for (const segment of [...record.segments, ...record.imagePatches]) {
    check(
      /^[a-z0-9-]+\.bin$/.test(segment.file),
      "Invalid ray CPU page filename",
    );
    await add(
      `/assets/latest-ray-parent-caches/${segment.file}`,
      `${directory}/${segment.file}`,
      segment.sha256,
    );
  }
}
for (const name of [
  "latest-parent-frames.mjs",
  "latest-parent-draw-parameters.mjs",
  "latest-parent-render-frame.mjs",
  "latest-parent-worker.mjs",
  "latest-parent-worker-client.mjs",
  "latest-parent-math.mjs",
  "latest-parent-placement.mjs",
])
  await add(`/${name}`, `${root}/${name}`, sha(await raw(`${root}/${name}`)));
let httpChecks = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  const entries = [...files];
  let next = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, async () => {
      while (next < entries.length) {
        const [url, ref] = entries[next++],
          response = await fetch(base + url, {
            signal: AbortSignal.timeout(15000),
          });
        check(
          response.status === 200,
          `Ray HTTP ${response.status}: ${base}${url}`,
        );
        check(
          sha(new Uint8Array(await response.arrayBuffer())) === ref.sha256,
          `Ray HTTP bytes differ: ${base}${url}`,
        );
        httpChecks++;
      }
    }),
  );
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
  console.log(JSON.stringify({ base, files: files.size, httpChecks }));
}
const result = {
  schema: 1,
  kind: "private-ray-parent-cpu-publication",
  inputs,
  files: Object.fromEntries(files),
  comparisonSha256: inputs[resolve(comparisonPath)],
  workerComparisonSha256: inputs[resolve(workerPath)],
  counts: { files: files.size, httpChecks, ...comparison.counts },
  scope: {
    staticBuildCpuResources: true,
    originalNativeGeometryCompared: true,
    realModuleWorkersCompared: true,
    browserBundlesBuilt: true,
    materialBridgePrepared: false,
    gpuDrawObserved: false,
    mainViewerEnabled: false,
    browserExecuted: false,
    matchLifecycleMapping: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/ray-parent-frames-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts: result.counts }));
