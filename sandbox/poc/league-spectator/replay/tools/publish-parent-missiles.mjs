// Publish the simultaneous replay-parent comparison and scoped render evidence.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = `${cache}/public`;
const raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const inputPath = `${cache}/research/parent-missile-inputs.json`,
  nativePath = `${cache}/research/parent-missiles-native.json`,
  proofPath = `${cache}/research/parent-missiles-wasm.json`,
  rendererPath = `${cache}/research/parent-renderer-comparison.json`,
  timelinePath = `${cache}/research/parent-timeline.json`,
  visualPath = `${assets}/evidence/latest-parent-missiles.json`;
const input = await read(inputPath),
  nativeBytes = await raw(nativePath),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  proofBytes = await raw(proofPath),
  proof = JSON.parse(new TextDecoder().decode(proofBytes)),
  renderer = await read(rendererPath),
  timeline = await read(timelinePath),
  visual = await read(visualPath);
check(
  input.kind === "replay-derived-parent-missile-inputs" &&
    input.counts.bursts === 2 &&
    input.counts.parents === 30 &&
    input.counts.worldFrames === 37 &&
    input.counts.parentUpdates === 555,
  "Incomplete replay parent inputs",
);
check(
  native.kind === "simultaneous-native-replay-parents" &&
    native.inputSha256 === sha(await raw(inputPath)) &&
    native.counts.returningBursts === 2 &&
    native.counts.parents === 30 &&
    native.counts.parentUpdates === 555,
  "Incomplete simultaneous native parent reference",
);
check(
  proof.kind === "simultaneous-replay-parent-native-wasm-comparison" &&
    proof.observationSha256 === sha(nativeBytes) &&
    proof.mismatchCount === 0 &&
    proof.counts.parents === 30 &&
    proof.counts.forwardWorldFrames === 37 &&
    proof.counts.forwardParentUpdates === 555 &&
    proof.counts.restoredWorldFrames === 25 &&
    proof.counts.restoredParentUpdates === 375 &&
    proof.counts.geometryRecords === 10230 &&
    proof.counts.worldContinuations === 2 &&
    proof.scope.simultaneousParents &&
    proof.scope.independentBurstContexts &&
    !proof.scope.originalEffectEventMapping &&
    !proof.scope.originalSeedAndJobOrdering &&
    !proof.scope.browserExecuted &&
    !proof.scope.mainViewerIntegrated &&
    !proof.scope.referenceCompared,
  "Incomplete or overstated simultaneous worker proof",
);
check(
  renderer.kind === "complete-parent-renderer-attribute-comparison" &&
    renderer.nativeObservationSha256 === sha(nativeBytes) &&
    renderer.workerProofSha256 === sha(proofBytes) &&
    renderer.mismatchCount === 0 &&
    renderer.counts.drawRecords === 10230 &&
    renderer.counts.parentFrames === 930 &&
    renderer.counts.rejections === 10 &&
    renderer.counts.hiddenFrames === 1 &&
    renderer.scope.actualThreeAttributeAdapter &&
    renderer.scope.nativeAttributeBitsUnchanged &&
    !renderer.scope.threeGpuSubmissionObserved &&
    !renderer.scope.browserExecuted &&
    !renderer.scope.mainViewerIntegrated,
  "Incomplete or overstated parent renderer proof",
);
check(
  timeline.kind === "seekable-complete-parent-timeline-comparison" &&
    timeline.nativeObservationSha256 === sha(nativeBytes) &&
    timeline.mismatchCount === 0 &&
    timeline.counts.nativeWorldFrames === 37 &&
    timeline.counts.nativeGeometryRecords === 6105 &&
    timeline.counts.fractionalComparisons === 6 &&
    timeline.counts.repeatedSamples === 6 &&
    timeline.counts.backwardSeeks === 12 &&
    timeline.counts.completedBursts === 2 &&
    timeline.counts.completedIdleSamples === 4 &&
    timeline.counts.canonicalWorldComparisons === 2 &&
    timeline.counts.completedIdleWorldComparisons === 4 &&
    timeline.scope.completionFromNativeParentFlagsAndEmptyPools &&
    !timeline.scope.originalDestructionImplemented &&
    !timeline.scope.mainViewerIntegrated &&
    !timeline.scope.browserExecuted &&
    !timeline.scope.referenceCompared,
  "Incomplete or overstated seekable parent timeline proof",
);
check(
  visual.kind === "simultaneous-replay-parent-shader-diagnostic" &&
    visual.observationSha256 === sha(nativeBytes) &&
    visual.inspectionSha256 === sha(proofBytes) &&
    visual.counts.panels === 2 &&
    visual.counts.draws === 330 &&
    visual.scope.decodedMissileTrajectories &&
    visual.scope.wasmGeometryCompared &&
    visual.scope.sceneInputsAndPassOrderSupplied &&
    !visual.scope.matchReplayFrame &&
    !visual.scope.browserExecuted &&
    !visual.scope.referenceCompared,
  "Incomplete or overstated replay parent visual",
);
for (const [file, digest] of Object.entries(native.sources))
  check(
    sha(await raw(resolve(import.meta.dir, file))) === digest,
    `Native replay parent producer changed: ${file}`,
  );
for (const report of [input, proof, renderer, timeline])
  for (const [file, digest] of Object.entries(report.sources))
    check(
      sha(await raw(resolve(import.meta.dir, "..", file))) === digest,
      `Replay parent producer changed: ${file}`,
    );
for (const report of [input, native, proof, renderer, visual, timeline])
  for (const [file, digest] of Object.entries(report.inputs))
    check(
      sha(await raw(file)) === digest,
      `Replay parent input changed: ${file}`,
    );
check(
  sha(await raw(resolve(import.meta.dir, "render-parent-frames.py"))) ===
    visual.rendererSha256,
  "Replay parent diagnostic renderer changed",
);
const image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
check(
  sha(image) === native.decoderImageSha256,
  "Replay parent decoder image changed",
);
for (const block of native.originalBlocks)
  check(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Executed simultaneous parent code changed",
  );
for (const draw of visual.draws) {
  const c = native.cases[draw.caseIndex],
    f = c.frames.find((f) => f.index + 1 === draw.tick),
    p = f.parents.find((p) => p.sequence === draw.sequence),
    g = p.geometry.find((g) => g.emitterIndex === draw.emitterIndex);
  check(
    c.effectId === draw.effectId &&
      sha(Buffer.from(g.verticesHex, "hex")) === draw.verticesSha256 &&
      sha(Buffer.from(g.indicesHex, "hex")) === draw.indicesSha256,
    "Replay shader diagnostic used different native geometry",
  );
}
const files = new Map();
async function add(url, path, expected) {
  const b = await raw(path),
    digest = sha(b);
  check(
    !expected || expected === digest,
    `Replay publication bytes differ: ${path}`,
  );
  files.set(url, { path, sha256: digest });
}
const gzip = Bun.gzipSync(nativeBytes);
check(
  sha(Bun.gunzipSync(gzip)) === sha(nativeBytes),
  "Simultaneous native proof gzip differs",
);
for (const [name, bytes] of [
  ["latest-parent-missile-inputs.json", await raw(inputPath)],
  ["latest-parent-missiles-native.json.gz", gzip],
  ["latest-parent-missiles-wasm.json", proofBytes],
  ["latest-parent-renderer.json", await raw(rendererPath)],
  ["latest-parent-timeline.json", await raw(timelinePath)],
]) {
  const path = `${assets}/evidence/${name}`;
  await Bun.write(path, bytes);
  await add(`/assets/evidence/${name}`, path, sha(bytes));
}
await add(
  "/assets/evidence/latest-parent-missiles.png",
  `${assets}/evidence/latest-parent-missiles.png`,
  visual.imageSha256,
);
await add("/assets/evidence/latest-parent-missiles.json", visualPath);
for (const name of [
  "latest-parent-missile-inputs.mjs",
  "latest-parent-missile-timeline.mjs",
  "latest-parent-render-frame.mjs",
  "latest-parent-renderer.mjs",
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
      `Replay parent HTTP bytes differ: ${base + url}`,
    );
    httpChecks++;
  }
const result = {
  schema: 1,
  kind: "simultaneous-replay-parent-evidence-publication",
  nativeSha256: sha(nativeBytes),
  proofSha256: sha(proofBytes),
  rendererSha256: sha(await raw(rendererPath)),
  timelineSha256: sha(await raw(timelinePath)),
  visualSha256: sha(await raw(visualPath)),
  files: Object.fromEntries(files),
  httpChecks,
  counts: proof.counts,
  publisherSha256: sha(await raw(import.meta.path)),
  scope: proof.scope,
};
await Bun.write(
  `${cache}/research/parent-missiles-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    httpChecks,
    files: files.size,
    counts: proof.counts,
    imageSha256: visual.imageSha256,
  }),
);
