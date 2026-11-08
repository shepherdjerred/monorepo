// Publish moving-parent component evidence and its scoped shader diagnostic.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = `${cache}/public`;
const raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const nativePath = `${cache}/research/parent-placement-native.json`,
  proofPath = `${cache}/research/parent-placement-wasm.json`,
  visualPath = `${assets}/evidence/latest-parent-placement.json`;
const nativeBytes = await raw(nativePath),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  proofBytes = await raw(proofPath),
  proof = JSON.parse(new TextDecoder().decode(proofBytes)),
  visual = await read(visualPath);
check(
  native.kind === "original-parent-placement-frames" &&
    native.build === "16.21.829.8620" &&
    native.protocol === "20e09df23c66b85e" &&
    native.counts.roots === 10 &&
    native.counts.returningRoots === 10 &&
    native.counts.frames === 600 &&
    native.counts.geometryRecords === 3300,
  "Incomplete native placement observation",
);
check(
  proof.kind === "original-parent-placement-native-wasm-worker-comparison" &&
    proof.observationSha256 === sha(nativeBytes) &&
    proof.mismatchCount === 0 &&
    proof.counts.roots === 10 &&
    proof.counts.forwardFrames === 600 &&
    proof.counts.restoredFrames === 480 &&
    proof.counts.geometryRecords === 5940 &&
    proof.counts.initialPlacementComparisons === 10 &&
    proof.counts.worldContinuations === 10 &&
    proof.scope.originalSettersAndProviderFreeSync &&
    proof.scope.initialPlacementBeforeParentActivation &&
    !proof.scope.entityBoneProviders &&
    !proof.scope.replayFieldMapping &&
    !proof.scope.browserExecuted &&
    !proof.scope.mainViewerIntegrated &&
    !proof.scope.referenceCompared,
  "Incomplete or overstated moving-parent worker evidence",
);
check(
  visual.kind === "moving-native-parent-shader-diagnostic" &&
    visual.observationSha256 === sha(nativeBytes) &&
    visual.inspectionSha256 === sha(proofBytes) &&
    visual.counts.panels === 10 &&
    visual.counts.draws === 52 &&
    visual.scope.wasmGeometryCompared &&
    visual.scope.sceneInputsAndPassOrderSupplied &&
    !visual.scope.fullNativeMaterialFrameBindings &&
    !visual.scope.matchReplayFrame &&
    !visual.scope.browserExecuted &&
    !visual.scope.referenceCompared,
  "Incomplete or overstated moving-parent visual evidence",
);
for (const [file, digest] of Object.entries(native.sources))
  check(
    sha(await raw(resolve(import.meta.dir, file))) === digest,
    `Native placement producer changed: ${file}`,
  );
for (const [file, digest] of Object.entries(proof.sources))
  check(
    sha(await raw(resolve(import.meta.dir, "..", file))) === digest,
    `Placement worker producer changed: ${file}`,
  );
for (const report of [native, proof, visual])
  for (const [file, digest] of Object.entries(report.inputs))
    check(sha(await raw(file)) === digest, `Placement input changed: ${file}`);
check(
  sha(await raw(resolve(import.meta.dir, "render-parent-frames.py"))) ===
    visual.rendererSha256,
  "Placement renderer changed",
);
const image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
check(
  sha(image) === native.decoderImageSha256,
  "Placement decoder image changed",
);
for (const block of native.originalBlocks)
  check(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Executed placement instruction bytes changed",
  );
for (const draw of visual.draws) {
  const c = native.cases.find((c) => c.effectId === draw.effectId),
    f = c.frames.find((f) => f.tick === draw.tick),
    g = f.geometry.find((g) => g.emitterIndex === draw.emitterIndex);
  check(
    sha(Buffer.from(g.verticesHex, "hex")) === draw.verticesSha256 &&
      sha(Buffer.from(g.indicesHex, "hex")) === draw.indicesSha256,
    "Moving-parent visual used different geometry",
  );
}
const files = new Map();
async function add(url, path, expected) {
  const b = await raw(path),
    digest = sha(b);
  check(
    !expected || expected === digest,
    `Placement publication bytes differ: ${path}`,
  );
  files.set(url, { path, sha256: digest });
}
const gzip = Bun.gzipSync(nativeBytes);
check(
  sha(Bun.gunzipSync(gzip)) === sha(nativeBytes),
  "Placement gzip roundtrip differs",
);
for (const [name, bytes] of [
  ["latest-parent-placement-native.json.gz", gzip],
  ["latest-parent-placement-wasm.json", proofBytes],
]) {
  const path = `${assets}/evidence/${name}`;
  await Bun.write(path, bytes);
  await add(`/assets/evidence/${name}`, path, sha(bytes));
}
await add(
  "/assets/evidence/latest-parent-placement.png",
  `${assets}/evidence/latest-parent-placement.png`,
  visual.imageSha256,
);
await add("/assets/evidence/latest-parent-placement.json", visualPath);
await add(
  "/latest-parent-placement.mjs",
  resolve(import.meta.dir, "..", "latest-parent-placement.mjs"),
);
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
      `Placement HTTP bytes differ: ${base + url}`,
    );
    httpChecks++;
  }
const result = {
  schema: 1,
  kind: "moving-parent-placement-evidence-publication",
  nativeObservationSha256: sha(nativeBytes),
  workerProofSha256: sha(proofBytes),
  visualSha256: sha(await raw(visualPath)),
  files: Object.fromEntries(files),
  httpChecks,
  counts: proof.counts,
  publisherSha256: sha(await raw(import.meta.path)),
  scope: proof.scope,
};
await Bun.write(
  `${cache}/research/parent-placement-publication.json`,
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
