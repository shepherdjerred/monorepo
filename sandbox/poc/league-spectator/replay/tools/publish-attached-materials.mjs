import { resolve, dirname, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ATTACHED_RESOURCES_SHA } from "../latest-attached-resources.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: publish-attached-materials.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  nativePath = `${cache}/research/attached-materials-native.json`,
  proofPath = `${cache}/research/attached-materials-comparison.json`,
  native = await json(nativePath),
  proof = await json(proofPath),
  programs = await json(`${cache}/research/attached-material-programs.json`),
  geometry = await json(`${cache}/research/attached-material-geometry.json`),
  visual = await json(`${assets}/evidence/latest-attached-materials.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  shadow = await json(`${assets}/latest-attached-shadow-shaders/package.json`),
  resourceNative = await json(
    `${cache}/research/attached-resources-native.json`,
  ),
  resourceProof = await json(
    `${cache}/research/attached-resources-comparison.json`,
  );
check(
  sha(await raw(nativePath)) ===
    "26cc485cb06f18d69cb902a3e4971a5cb9dd03ea0527a5a827189ba7d06b7514" &&
    proof.nativeSha256 === sha(await raw(nativePath)) &&
    proof.inspectorSha256 ===
      sha(await raw(`${root}/tools/inspect-attached-materials.mjs`)) &&
    proof.sourceSha256 ===
      sha(await raw(`${root}/latest-attached-materials.mjs`)) &&
    programs.comparisonSha256 === sha(await raw(proofPath)) &&
    programs.observerSha256 ===
      sha(await raw(`${root}/tools/observe-attached-material-programs.py`)) &&
    programs.angleAdapterSha256 ===
      sha(await raw(`${root}/tools/observe-shader-angle.py`)) &&
    geometry.exporterSha256 ===
      sha(await raw(`${root}/tools/export-attached-material-geometry.mjs`)) &&
    visual.rendererSha256 ===
      sha(await raw(`${root}/tools/render-attached-materials.py`)) &&
    visual.drawAdapterSha256 ===
      sha(await raw(`${root}/tools/render-particle-shader.py`)) &&
    visual.imageSha256 ===
      sha(await raw(`${assets}/evidence/latest-attached-materials.png`)) &&
    shadow.nativeMaterialSha256 === sha(await raw(nativePath)) &&
    shadow.compiler.preparationSha256 ===
      sha(await raw(`${root}/tools/prepare-attached-shadow-shaders.mjs`)),
  "Attached material evidence stale",
);
check(
  resourceNative.packageSha256 === ATTACHED_RESOURCES_SHA &&
    resourceProof.packageSha256 === ATTACHED_RESOURCES_SHA &&
    sha(await raw(`${assets}/latest-attached-resources/package.json`)) ===
      ATTACHED_RESOURCES_SHA &&
    resourceProof.inspectorSha256 ===
      sha(await raw(`${root}/tools/inspect-attached-resources.mjs`)) &&
    resourceProof.moduleSha256 ===
      sha(await raw(`${root}/latest-attached-resources.mjs`)) &&
    isDeepStrictEqual(resourceNative.counts, {
      resolvedInitialSelections: 179,
      noAuthoredMesh: 179,
      emitters: 181,
      initializers: 362,
      prefixes: 362,
      repeatedLoads: 181,
      assetPreservationChecks: 362,
      externalFactoryBoundaries: 2,
    }) &&
    isDeepStrictEqual(resourceProof.counts, {
      emitters: 181,
      initialSelectionChecks: 179,
      externalBoundaries: 2,
      descriptionCopies: 181,
      rejectionChecks: 10,
    }) &&
    resourceProof.scope.initialResourcePrefixOnly === true &&
    resourceProof.scope.nativeInitializerExecuted === true &&
    resourceProof.scope.nativePathRoutingExecuted === true &&
    resourceProof.scope.externalFactoryExecuted === false &&
    resourceProof.scope.laterResourceMutationVerified === false &&
    resourceProof.scope.meshPoseBindingExecuted === false,
  "Initial attached resource evidence differs",
);
for (const [name, h] of Object.entries(resourceNative.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    `Initial resource source changed: ${name}`,
  );
for (const block of resourceNative.originalBlocks)
  check(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Initial resource native instruction changed",
  );
for (const record of [
  native,
  proof,
  programs,
  geometry,
  visual,
  resourceNative,
  resourceProof,
])
  for (const [p, h] of Object.entries(record.inputs))
    check(sha(await raw(p)) === h, `Attached material input changed: ${p}`);
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    `Native material source changed: ${name}`,
  );
for (const block of native.originalBlocks)
  check(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Native material instruction changed",
  );
check(
  isDeepStrictEqual(native.counts, {
    shaderSelections: 9231,
    renderStates: 9231,
    assetPreservationChecks: 181,
    emitters: 181,
    parameters: 547,
    samplers: 427,
    erosionEmitters: 65,
  }) &&
    isDeepStrictEqual(proof.counts, {
      emitters: 181,
      descriptions: 9231,
      vectorChecks: 38703,
      sourceScalarChecks: 4719,
      samplers: 21777,
      mutationChecks: 181,
      rejectionChecks: 13,
    }) &&
    isDeepStrictEqual(programs.counts, {
      compiled: 149,
      compileFailures: 0,
      linked: 138,
      linkFailures: 0,
      unresolvedSelections: 1,
    }),
  "Attached material coverage differs",
);
check(
  proof.unsupportedPrograms.length === 1 &&
    proof.unsupportedPrograms[0].observations === 2 &&
    proof.unsupportedPrograms[0].selection.defines.length === 1 &&
    proof.unsupportedPrograms[0].selection.defines[0].name ===
      "SOFT_PARTICLES" &&
    isDeepStrictEqual(
      programs.unresolvedSelections,
      proof.unsupportedPrograms,
    ) &&
    programs.programs.every((p) => p.success) &&
    programs.stages.every((p) => p.success) &&
    visual.samples.length === 2 &&
    isDeepStrictEqual(
      visual.samples.map((s) => s.triangles),
      [19769, 2553],
    ) &&
    visual.samples.every((s) => s.visiblePixels > 100) &&
    visual.scope.offscreenTranslatedMeshShaderRendered === true &&
    visual.scope.initialMeshResourceBranchFromNative === true &&
    visual.scope.suppliedPosePalette === true &&
    visual.scope.suppliedMaterialEnvironment === true &&
    visual.scope.suppliedColorAndFresnel === true &&
    visual.scope.nativeMeshPoseBindingExecuted === false &&
    visual.scope.originalGpuPaletteBindingVerified === false &&
    visual.scope.effectLifecycleReconstructed === false &&
    visual.scope.depthCullPassesVerified === false &&
    visual.scope.browserRun === false &&
    visual.scope.mainViewerIntegrated === false &&
    visual.scope.referencePixelsCompared === false,
  "Attached material scope differs",
);
const build = await Bun.build({
  entrypoints: [
    `${root}/latest-attached-materials.mjs`,
    `${root}/latest-attached-resources.mjs`,
  ],
  target: "browser",
  external: ["three", "/assets/*"],
});
check(
  build.success && build.outputs.length === 2,
  "Attached material browser-target build failed",
);
const paths = new Map(),
  visited = new Set();
async function include(file) {
  if (visited.has(file)) return;
  visited.add(file);
  paths.set(`/${relative(root, file).replaceAll("\\", "/")}`, file);
  for (const m of (await Bun.file(file).text()).matchAll(
    /(?:from\s*|import\s*\()\s*["'](\.\.?\/[^"']+\.mjs)["']/g,
  ))
    await include(resolve(dirname(file), m[1]));
}
await include(`${root}/latest-attached-materials.mjs`);
await include(`${root}/latest-attached-resources.mjs`);
for (const name of ["README.md", "AV-FIDELITY-MAP.md"])
  paths.set(`/${name}`, `${root}/${name}`);
for (const record of [
  native,
  proof,
  programs,
  geometry,
  visual,
  resourceNative,
  resourceProof,
])
  for (const file of Object.keys(record.inputs)) {
    const rel = relative(assets, resolve(file));
    if (!rel.startsWith("..") && !rel.includes(":"))
      paths.set(`/assets/${rel.replaceAll("\\", "/")}`, file);
  }
for (const t of shadow.translations)
  for (const name of [t.file, t.dxbc])
    paths.set(
      `/assets/latest-attached-shadow-shaders/${name}`,
      `${assets}/latest-attached-shadow-shaders/${name}`,
    );
for (const name of ["png", "json"])
  paths.set(
    `/assets/evidence/latest-attached-materials.${name}`,
    `${assets}/evidence/latest-attached-materials.${name}`,
  );
for (const name of [
  "attached-materials-native.json",
  "attached-materials-comparison.json",
  "attached-material-programs.json",
  "attached-material-geometry.json",
  "attached-resources-native.json",
  "attached-resources-comparison.json",
]) {
  const dest = `${assets}/evidence/${name}`;
  await Bun.write(dest, await raw(`${cache}/research/${name}`));
  paths.set(`/assets/evidence/${name}`, dest);
}
const packagePath = `${assets}/latest-attached-materials/package.json`;
await Bun.write(packagePath, await raw(nativePath));
paths.set("/assets/latest-attached-materials/package.json", packagePath);
const files = await Promise.all(
    [...paths].map(async ([path, file]) => ({
      path,
      sha256: sha(await raw(file)),
    })),
  ),
  checks = [];
for (const origin of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  let cursor = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, async () => {
      while (cursor < files.length) {
        const item = files[cursor++],
          r = await fetch(`${origin}${item.path}`, {
            signal: AbortSignal.timeout(30000),
          });
        check(
          r.status === 200 && sha(await r.arrayBuffer()) === item.sha256,
          `HTTP material delivery differs: ${origin}${item.path}`,
        );
        checks.push({ url: `${origin}${item.path}`, sha256: item.sha256 });
      }
    }),
  );
  for (const r of results) if (r.status === "rejected") throw r.reason;
}
await Bun.write(
  `${cache}/research/attached-materials-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      publisherSha256: sha(await raw(import.meta.path)),
      comparisonSha256: sha(await raw(proofPath)),
      imageSha256: visual.imageSha256,
      counts: proof.counts,
      programCounts: programs.counts,
      initialResourceCounts: resourceProof.counts,
      scope: visual.scope,
      checks: checks.sort((a, b) => a.url.localeCompare(b.url)),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    matchedFiles: checks.length,
    counts: proof.counts,
    programCounts: programs.counts,
    initialResourceCounts: resourceProof.counts,
  }),
);
