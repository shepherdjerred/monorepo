// Verify the original-material library and its explicitly controlled offscreen
// image on the existing private preview. This does not enable replay effects.
import { resolve } from "node:path";
import { NATIVE_PARENT_MATERIALS_SHA } from "../latest-native-parent-materials.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  directory = `${assets}/latest-parent-native-materials`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  files = new Map(),
  proofPath = `${cache}/research/parent-native-materials-comparison.json`,
  proof = await read(proofPath),
  visualPath = `${assets}/evidence/latest-parent-native-materials.json`,
  visual = await read(visualPath),
  metadata = await read(`${directory}/package.json`);
check(
  proof.kind === "native-wasm-portable-parent-material-comparison" &&
    proof.mismatchCount === 0 &&
    proof.packageSha256 === NATIVE_PARENT_MATERIALS_SHA &&
    sha(await raw(`${directory}/package.json`)) ===
      NATIVE_PARENT_MATERIALS_SHA &&
    proof.counts.roots === 14 &&
    proof.counts.actors === 83 &&
    proof.counts.authoredLookups === 581 &&
    proof.counts.variants === 83 &&
    proof.counts.controlledLookups === 12 &&
    proof.counts.immutableSnapshots === 87 &&
    proof.counts.textures === 72 &&
    proof.counts.exportIsolationChecks === 72 &&
    proof.counts.shaderStages === 17 &&
    proof.scope.authoredNativeWasmJavascriptCompared &&
    proof.scope.nativeGpuTextureConstantsAndStateCompared &&
    !proof.scope.sceneResourcesProvided &&
    !proof.scope.mainViewerEnabled &&
    !proof.scope.browserExecuted,
  "Complete scoped native/WASM/JS original material comparison required",
);
check(
  visual.kind === "native-parent-material-offscreen-snapshots" &&
    visual.counts.requestedRoots === 14 &&
    visual.counts.drawnRoots === 12 &&
    visual.counts.visibleRoots === 9 &&
    visual.counts.zeroPixelRoots === 3 &&
    visual.counts.boundaryRoots === 2 &&
    visual.counts.draws === 69 &&
    visual.counts.programs === 7 &&
    visual.scope.actualCapturedMaterialResources &&
    visual.scope.nativePipelineAndSamplerApplied &&
    visual.scope.depthStencilAttachmentProvided &&
    visual.scope.missingSceneInputsRejectWholeRoot &&
    visual.scope.controlledSceneFixture &&
    visual.scope.gpuDrawSubmitted &&
    !visual.scope.replayPlacementReconstructed &&
    !visual.scope.browserExecuted &&
    !visual.scope.referenceCompared,
  "Complete scoped material snapshot evidence required",
);
for (const [report, base] of [
  [proof, root],
  [visual, `${root}/tools`],
]) {
  for (const [name, digest] of Object.entries(report.sources))
    check(
      sha(await raw(`${base}/${name}`)) === digest,
      `Original material source changed: ${name}`,
    );
  for (const [path, digest] of Object.entries(report.inputs))
    check(
      sha(await raw(path)) === digest,
      `Original material input changed: ${path}`,
    );
}
check(
  metadata.kind === "prepared-original-parent-materials" &&
    metadata.scope.allObservedActorsAndPassesPreserved &&
    !metadata.scope.sceneInputsProvided &&
    !metadata.scope.gpuDrawSubmitted &&
    metadata.counts.actors === 83,
  "Build-only full native material package required",
);
async function add(url, path, digest) {
  const bytes = await raw(path);
  check(
    sha(bytes) === digest,
    `Original material publication bytes differ: ${url}`,
  );
  check(
    !files.has(url) || files.get(url).sha256 === digest,
    "Conflicting material publication URL",
  );
  files.set(url, { path, sha256: digest, bytes: bytes.length });
}
await add(
  "/latest-native-parent-materials.mjs",
  `${root}/latest-native-parent-materials.mjs`,
  proof.sources["latest-native-parent-materials.mjs"],
);
await add(
  "/assets/latest-parent-native-materials/package.json",
  `${directory}/package.json`,
  NATIVE_PARENT_MATERIALS_SHA,
);
for (const texture of Object.values(metadata.textures))
  for (const level of texture.levels)
    for (const plane of level) {
      check(
        /^planes\/[a-f0-9]{64}\.bin$/.test(plane.file),
        "Invalid material texture publication path",
      );
      await add(
        `/assets/latest-parent-native-materials/${plane.file}`,
        `${directory}/${plane.file}`,
        plane.sha256,
      );
    }
for (const ref of Object.values(metadata.shaderStages)) {
  check(
    /^stages\/[a-f0-9]{64}\.json$/.test(ref.file),
    "Invalid material shader publication path",
  );
  await add(
    `/assets/latest-shaders/${ref.file}`,
    `${assets}/latest-shaders/${ref.file}`,
    ref.sha256,
  );
}
await add(
  "/assets/evidence/latest-parent-native-materials.png",
  `${assets}/evidence/latest-parent-native-materials.png`,
  visual.imageSha256,
);
await add(
  "/assets/evidence/latest-parent-native-materials.json",
  visualPath,
  inputs[visualPath],
);
let httpChecks = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  let next = 0;
  const entries = [...files],
    results = await Promise.allSettled(
      Array.from({ length: 4 }, async () => {
        while (next < entries.length) {
          const [path, ref] = entries[next++],
            response = await fetch(base + path, {
              signal: AbortSignal.timeout(15000),
            });
          check(
            response.status === 200,
            `Original material HTTP ${response.status}: ${base}${path}`,
          );
          check(
            sha(new Uint8Array(await response.arrayBuffer())) === ref.sha256,
            `Original material HTTP bytes differ: ${base}${path}`,
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
  kind: "private-original-parent-material-publication",
  inputs,
  comparisonSha256: inputs[proofPath],
  visualSha256: inputs[visualPath],
  files: Object.fromEntries(files),
  counts: { files: files.size, httpChecks, ...metadata.counts },
  visualCounts: visual.counts,
  scope: {
    buildResourceLibrary: true,
    controlledOffscreenSnapshots: true,
    mainViewerEnabled: false,
    perFrameUpdatesPrepared: false,
    matchLifecycleMapping: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/parent-native-materials-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({ counts: result.counts, visualCounts: result.visualCounts }),
);
