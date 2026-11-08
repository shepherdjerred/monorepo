// Private preview publication of scoped real renderer flow and offscreen proof.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  assets = `${cache}/public`,
  root = resolve(import.meta.dir, "..");
const raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
const check = (ok, m) => {
  if (!ok) throw Error(m);
};
const flowPath = `${cache}/research/parent-viewer.json`,
  visualPath = `${assets}/evidence/latest-parent-viewer.json`,
  texturePath = `${assets}/latest-parent-textures/package.json`;
const flowBytes = await raw(flowPath),
  flow = JSON.parse(new TextDecoder().decode(flowBytes)),
  visual = await read(visualPath),
  textures = await read(texturePath);
check(
  flow.kind === "complete-parent-viewer-flow-comparison" &&
    flow.mismatchCount === 0 &&
    flow.counts.canonicalFrames === 37 &&
    flow.counts.nativeDrawComparisons === 7335 &&
    flow.counts.reverseSeeks === 7 &&
    flow.counts.disabledFrames === 1 &&
    flow.counts.repeatedFrameCacheHits === 2 &&
    flow.counts.staleCommitsPrevented === 1 &&
    flow.counts.completedIdleWithoutWorkerRequests === 1 &&
    flow.counts.disposedRejections === 2 &&
    flow.counts.loadOwnershipRejections === 2 &&
    flow.counts.pendingDisposalRejections === 1 &&
    flow.scope.actualThreeLoadPrepareCommit &&
    flow.scope.actualRgbaDataTextures &&
    flow.scope.mainViewerSourceIntegrated &&
    !flow.scope.browserExecuted &&
    !flow.scope.threeGpuSubmissionObserved &&
    !flow.scope.realTimePlaybackEstablished &&
    !flow.scope.referenceCompared,
  "Incomplete or overstated parent viewer flow proof",
);
check(
  visual.kind === "committed-parent-viewer-offscreen-diagnostic" &&
    visual.flowProofSha256 === sha(flowBytes) &&
    visual.counts.panels === 2 &&
    visual.counts.draws === 330 &&
    visual.scope.actualCommittedThreeBuffersAndUniforms &&
    visual.scope.actualDataTexturePixels &&
    visual.scope.diagnosticDepthAndCullingDisabled &&
    !visual.scope.browserExecuted &&
    !visual.scope.threeGpuSubmissionObserved &&
    !visual.scope.referenceCompared,
  "Incomplete or overstated parent viewer visual",
);
for (const [name, digest] of Object.entries(flow.sources))
  check(
    sha(await raw(`${root}/${name}`)) === digest,
    `Changed flow source: ${name}`,
  );
for (const report of [flow, visual])
  for (const [path, digest] of Object.entries(report.inputs))
    check(sha(await raw(path)) === digest, `Changed flow input: ${path}`);
check(
  sha(await raw(`${root}/tools/render-parent-viewer.py`)) ===
    visual.rendererSha256,
  "Changed committed-frame renderer",
);
check(
  textures.kind === "prepared-parent-rgba8-textures" &&
    !textures.scope.containsReplayData &&
    textures.scope.pixelFormat === "RGBA8" &&
    textures.scope.rowOrder === "source-top-to-bottom" &&
    !textures.scope.premultiplied &&
    !textures.scope.colorSpaceConversion &&
    textures.preparerSha256 ===
      sha(await raw(`${root}/tools/prepare-parent-textures.py`)),
  "Changed parent texture preparation contract",
);
for (const [path, digest] of Object.entries(textures.packages))
  check(
    sha(await raw(`${assets}/${path}`)) === digest,
    `Changed texture material input: ${path}`,
  );
const files = new Map(),
  add = async (url, path, digest) => {
    const data = await raw(path);
    if (digest)
      check(sha(data) === digest, `Changed publication bytes: ${url}`);
    files.set(url, { path, sha256: sha(data) });
  };
await add("/assets/latest-parent-textures/package.json", texturePath);
for (const directory of ["latest-effect-contexts", "latest-effect-resolvers"])
  await add(
    `/assets/${directory}/package.json`,
    `${assets}/${directory}/package.json`,
  );
for (const texture of Object.values(textures.textures)) {
  check(
    /^(?:textures\/[a-f0-9]+\.png)$/.test(texture.sourceFile) &&
      /^rgba-[a-f0-9]{64}\.bin$/.test(texture.file),
    "Invalid static texture path",
  );
  check(
    sha(await raw(`${assets}/latest-effects/${texture.sourceFile}`)) ===
      texture.sourceSha256,
    "Changed source PNG",
  );
  const path = `${assets}/latest-parent-textures/${texture.file}`;
  check(
    (await raw(path)).length === texture.bytes &&
      texture.bytes === texture.width * texture.height * 4,
    "Changed RGBA dimensions",
  );
  await add(
    `/assets/latest-parent-textures/${texture.file}`,
    path,
    texture.sha256,
  );
}
for (const name of Object.keys(flow.sources).filter(
  (name) => !name.startsWith("tools/"),
))
  await add(`/${name}`, `${root}/${name}`);
const publishedFlow = `${assets}/evidence/latest-parent-viewer-flow.json`;
await Bun.write(publishedFlow, flowBytes);
await add("/assets/evidence/latest-parent-viewer-flow.json", publishedFlow);
await add("/assets/evidence/latest-parent-viewer.json", visualPath);
await add(
  "/assets/evidence/latest-parent-viewer.png",
  `${assets}/evidence/latest-parent-viewer.png`,
  visual.imageSha256,
);
await add("/latest.html", `${root}/latest.html`);
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
      `Viewer HTTP bytes differ: ${base + url}`,
    );
    httpChecks++;
  }
const result = {
  schema: 1,
  kind: "complete-parent-viewer-private-preview-publication",
  files: Object.fromEntries(files),
  httpChecks,
  flowSha256: sha(flowBytes),
  imageSha256: visual.imageSha256,
  counts: flow.counts,
  publisherSha256: sha(await raw(import.meta.path)),
  scope: flow.scope,
};
await Bun.write(
  `${cache}/research/parent-viewer-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    httpChecks,
    files: files.size,
    counts: flow.counts,
    imageSha256: visual.imageSha256,
  }),
);
