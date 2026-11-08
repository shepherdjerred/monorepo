// Publish library/component evidence to the existing private preview only.
import { resolve } from "node:path";
import { WORLD_EFFECT_ABI_SHA } from "../latest-world-effect-abi.mjs";
import { WORLD_DESCRIPTOR_ABI_SHA } from "../latest-world-descriptor-abi.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = `${cache}/public`,
  root = resolve(import.meta.dir, ".."),
  raw = (p) => Bun.file(p).bytes(),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  proofPath = `${cache}/research/world-descriptors-comparison.json`,
  proofBytes = await raw(proofPath),
  proof = JSON.parse(new TextDecoder().decode(proofBytes)),
  visual = await read(`${assets}/evidence/latest-world-descriptors.json`),
  files = new Map();
check(
  proof.kind === "native-wasm-world-descriptor-factory-comparison" &&
    proof.counts.roots === 10 &&
    proof.counts.creationFieldComparisons === 180 &&
    proof.counts.forwardFrames === 120 &&
    proof.counts.restoredFrames === 60 &&
    proof.mismatchCount === 0 &&
    !proof.scope.partialActorSelection &&
    proof.scope.completeOriginalDescriptorFactory &&
    proof.scope.explicitDetachedDescriptors &&
    !proof.scope.decodedReplayRequestsExecuted &&
    !proof.scope.browserExecuted &&
    !proof.scope.referenceCompared,
  "Complete scoped descriptor comparison required",
);
check(
  visual.kind === "supplied-world-descriptor-factory-offscreen-gallery" &&
    visual.comparisonSha256 === sha(proofBytes) &&
    visual.counts.panels === 10 &&
    visual.counts.draws === 52 &&
    visual.scope.explicitDetachedDescriptors &&
    visual.scope.nativeGeometryComparedWithWasm &&
    !visual.scope.matchReplayFrame &&
    !visual.scope.decodedReplayRequestsExecuted &&
    !visual.scope.browserExecuted &&
    !visual.scope.referenceCompared &&
    !visual.scope.realTimePerformanceEstablished &&
    visual.rendererSha256 ===
      sha(await raw(`${root}/tools/render-world-descriptors.py`)),
  "Complete scoped descriptor visual required",
);
for (const [name, digest] of Object.entries(proof.sources))
  check(
    sha(await raw(`${root}/${name}`)) === digest,
    `Changed descriptor source: ${name}`,
  );
for (const report of [proof, visual])
  for (const [path, digest] of Object.entries(report.inputs))
    check(sha(await raw(path)) === digest, `Changed descriptor input: ${path}`);
for (const [name, digest] of Object.entries({
  "latest-world-effect-abi": WORLD_EFFECT_ABI_SHA,
  "latest-world-descriptor-abi": WORLD_DESCRIPTOR_ABI_SHA,
})) {
  const path = `${assets}/${name}/package.json`,
    data = await raw(path);
  check(sha(data) === digest, `Changed static ABI: ${name}`);
  files.set(`/assets/${name}/package.json`, { path, sha256: digest });
}
for (const name of [
  "latest-world-effect-abi.mjs",
  "latest-world-effect-factory.mjs",
  "latest-world-descriptor-abi.mjs",
  "latest-world-descriptor-factory.mjs",
])
  files.set(`/${name}`, {
    path: `${root}/${name}`,
    sha256: sha(await raw(`${root}/${name}`)),
  });
for (const suffix of ["png", "json"]) {
  const path = `${assets}/evidence/latest-world-descriptors.${suffix}`,
    digest = sha(await raw(path));
  if (suffix === "png")
    check(digest === visual.imageSha256, "Changed descriptor gallery pixels");
  files.set(`/assets/evidence/latest-world-descriptors.${suffix}`, {
    path,
    sha256: digest,
  });
}
const viewer = new TextDecoder().decode(await raw(`${root}/latest-viewer.mjs`));
check(
  !viewer.includes("latest-world-descriptor-factory") &&
    !viewer.includes("descriptorFactoryBytes"),
  "Descriptor library publication scope needs a main viewer review",
);
let httpChecks = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
])
  for (const [path, ref] of files) {
    const response = await fetch(base + path, {
      signal: AbortSignal.timeout(15000),
    });
    check(
      response.status === 200 &&
        sha(new Uint8Array(await response.arrayBuffer())) === ref.sha256,
      `Private descriptor HTTP bytes differ: ${base}${path}`,
    );
    httpChecks++;
  }
const result = {
  schema: 1,
  kind: "private-world-descriptor-component-publication",
  files: Object.fromEntries(files),
  httpChecks,
  comparisonSha256: sha(proofBytes),
  imageSha256: visual.imageSha256,
  counts: proof.counts,
  scope: {
    libraryOnly: true,
    mainViewerEnabled: false,
    explicitDetachedDescriptors: true,
    decodedReplayRequestsExecuted: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/world-descriptors-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    files: files.size,
    httpChecks,
    counts: proof.counts,
    imageSha256: visual.imageSha256,
  }),
);
