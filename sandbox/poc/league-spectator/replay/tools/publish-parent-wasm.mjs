// Publish exact component evidence to the existing private preview server.
import { resolve } from "node:path";
import { PARENT_MATH_SHA } from "../latest-parent-math.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = `${cache}/public`;
const raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer());
const sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const parentPath = `${cache}/research/parent-frames-wasm.json`,
  mathPath = `${cache}/research/parent-math-wasm.json`,
  workerPath = `${cache}/research/parent-workers.json`;
const parent = await read(parentPath),
  math = await read(mathPath),
  worker = await read(workerPath),
  catalog = await read(`${assets}/latest-parent-math/package.json`);
check(
  parent.kind === "complete-parent-native-wasm-comparison" &&
    parent.mismatchCount === 0 &&
    parent.counts.roots === 10 &&
    parent.counts.frames === 600 &&
    parent.counts.geometryRecords === 3300 &&
    parent.counts.checkpointContinuationFrames === 480 &&
    parent.counts.checkpointGeometryRecords === 2640 &&
    parent.counts.checkpointCpuWorldComparisons === 10 &&
    parent.counts.rejectedInvalidOperations === 110 &&
    !parent.scope.partialInterval &&
    !parent.scope.mainViewerIntegrated &&
    !parent.scope.browserExecuted &&
    !parent.scope.referenceCompared &&
    parent.scope.modeledHostMathRegisterContract &&
    parent.scope.wasmCheckpointsCompared &&
    parent.scope.checkpointWorldIncludesMathScratch &&
    !parent.scope.originalMacosLibmVerified,
  "Parent evidence scope/counts differ",
);
check(
  math.kind === "parent-math-native-wasm-comparison" &&
    math.mathPackageSha256 === PARENT_MATH_SHA &&
    math.mismatchCount === 0 &&
    math.counts.nativeMathSamples === 2570 &&
    math.counts.nativeFusedSamples === 10492 &&
    !math.scope.browserExecuted &&
    !math.scope.completeFloatDomain &&
    !math.scope.originalMacosLibmVerified,
  "Math evidence scope/counts differ",
);
check(
  worker.kind === "complete-parent-module-worker-comparison" &&
    worker.mismatchCount === 0 &&
    worker.counts.roots === 10 &&
    worker.counts.forwardFrames === 600 &&
    worker.counts.restoredFrames === 480 &&
    worker.counts.geometryRecords === 5940 &&
    worker.counts.worldContinuations === 10 &&
    worker.counts.imageTransfers === 10 &&
    worker.counts.exportIsolationChecks === 10 &&
    worker.counts.ownershipRejections === 40 &&
    worker.counts.fatalBoundaryChecks === 10 &&
    worker.counts.cancelChecks === 1 &&
    worker.scope.realBunModuleWorkers &&
    worker.scope.staticHttpAssets &&
    worker.scope.transferredGeometryBuffers &&
    worker.scope.normalStateCaptureDisabledOnRestore &&
    !worker.scope.browserExecuted &&
    !worker.scope.mainViewerIntegrated &&
    !worker.scope.matchLifecycleMapping &&
    !worker.scope.referenceCompared,
  "Incomplete or overstated complete-parent worker evidence",
);
for (const proof of [parent, math, worker]) {
  for (const [file, digest] of Object.entries(proof.inputs))
    check(sha(await raw(file)) === digest, `Changed component input: ${file}`);
  for (const [file, digest] of Object.entries(proof.sources))
    check(
      sha(await raw(resolve(import.meta.dir, "..", file))) === digest,
      `Changed component producer: ${file}`,
    );
}
check(
  sha(await raw(`${assets}/latest-parent-math/package.json`)) ===
    PARENT_MATH_SHA &&
    sha(await raw(resolve(import.meta.dir, "prepare-parent-math.py"))) ===
      catalog.preparerSha256 &&
    sha(await raw(resolve(import.meta.dir, "math_isa.py"))) ===
      catalog.isaProducerSha256,
  "Original math preparation changed",
);
const files = new Map();
const add = async (url, path) => {
  const b = await raw(path);
  files.set(url, { path, sha256: sha(b) });
};
for (const [name, path] of [
  ["latest-parent-wasm.json", parentPath],
  ["latest-parent-math-wasm.json", mathPath],
  ["latest-parent-workers.json", workerPath],
]) {
  const target = `${assets}/evidence/${name}`;
  await Bun.write(target, await raw(path));
  await add(`/assets/evidence/${name}`, target);
}
await add(
  "/assets/latest-parent-math/package.json",
  `${assets}/latest-parent-math/package.json`,
);
for (const part of [catalog.image, catalog.trampolines])
  await add(
    `/assets/latest-parent-math/${part.file}`,
    `${assets}/latest-parent-math/${part.file}`,
  );
for (const name of [
  "latest-parent-frames.mjs",
  "latest-parent-placement.mjs",
  "latest-parent-math.mjs",
  "latest-math-isa.mjs",
  "latest-fused-math.mjs",
  "latest-parent-worker.mjs",
  "latest-parent-missile-timeline.mjs",
  "latest-parent-missile-inputs.mjs",
  "latest-missile-playback.mjs",
  "latest-parent-worker-client.mjs",
  "latest-particle-worker-client.mjs",
])
  await add(`/${name}`, resolve(import.meta.dir, "..", name));
let httpChecks = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
])
  for (const [url, file] of files) {
    const response = await fetch(base + url, {
      signal: AbortSignal.timeout(30000),
    });
    check(
      response.status === 200 &&
        sha(new Uint8Array(await response.arrayBuffer())) === file.sha256,
      `Component HTTP bytes differ: ${base + url}`,
    );
    httpChecks++;
  }
const result = {
  schema: 1,
  kind: "complete-parent-wasm-evidence-publication",
  parentEvidenceSha256: sha(await raw(parentPath)),
  mathEvidenceSha256: sha(await raw(mathPath)),
  workerEvidenceSha256: sha(await raw(workerPath)),
  files: Object.fromEntries(files),
  httpChecks,
  publisherSha256: sha(await raw(import.meta.path)),
  scope: {
    browserExecuted: false,
    mainViewerIntegrated: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/parent-wasm-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    httpChecks,
    files: files.size,
    parent: parent.counts,
    math: math.counts,
    worker: worker.counts,
  }),
);
