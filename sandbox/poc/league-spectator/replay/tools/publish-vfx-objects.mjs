// Publish component evidence to the existing preview; no browser acceptance claim.
import { resolve, dirname } from "node:path";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: publish-vfx-objects.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  read = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer()),
  json = async (path) => JSON.parse(new TextDecoder().decode(await read(path))),
  requireThat = (value, message) => {
    if (!value) throw Error(message);
  };
const nativePath = `${cache}/research/vfx-objects-native.json`,
  proofPath = `${cache}/research/vfx-objects-comparison.json`,
  visualPath = `${assets}/evidence/latest-vfx-objects.json`,
  native = await json(nativePath),
  proof = await json(proofPath),
  visual = await json(visualPath),
  packagePath = `${assets}/latest-vfx-objects/package.json`,
  meta = await json(packagePath),
  systems = await json(`${assets}/latest-vfx-system-assets/package.json`),
  effects = await json(`${assets}/latest-effects/manifest.json`),
  image = await read(`${assets}/decoder-16.21-macos/image.bin`);
requireThat(
  native.packageSha256 === sha(await read(packagePath)) &&
    proof.packageSha256 === native.packageSha256 &&
    proof.nativeEvidenceSha256 === sha(await read(nativePath)) &&
    proof.inspectorSha256 ===
      sha(await read(`${root}/tools/inspect-vfx-objects.mjs`)) &&
    visual.comparisonSha256 === sha(await read(proofPath)) &&
    visual.rendererSha256 ===
      sha(await read(`${root}/tools/render-vfx-objects.py`)) &&
    visual.imageSha256 ===
      sha(await read(`${assets}/evidence/latest-vfx-objects.png`)) &&
    JSON.stringify(visual.counts) === JSON.stringify(proof.counts) &&
    JSON.stringify(visual.qualityMultipliers) ===
      JSON.stringify([1, 1, 1, 1, 1, 1]) &&
    meta.decoderImageSha256 === sha(image) &&
    meta.build === "16.21.829.8620" &&
    meta.protocol === "20e09df23c66b85e" &&
    proof.build === meta.build &&
    proof.protocol === meta.protocol &&
    proof.mismatches.length === 0 &&
    proof.counts.stageMismatches === 0 &&
    proof.counts.stateMismatches === 0 &&
    proof.counts.authoredMutations === 0 &&
    proof.counts.staleHandleChecks === proof.counts.cases - 1 &&
    proof.counts.qualityChecks === proof.counts.cases &&
    proof.scope.wasmObjectFactoryExecuted &&
    proof.scope.completeAuthoredRoots &&
    proof.scope.originalScalarSettersExecuted &&
    proof.scope.originalReadySetterExecuted &&
    !proof.scope.completeManagerConstructorExecuted &&
    !proof.scope.workerPoolExecuted &&
    !proof.scope.parentActivationExecuted &&
    !proof.scope.resourceAcquisitionExecuted &&
    !proof.scope.worldRegistryExecuted &&
    !proof.scope.mainViewerIntegrated &&
    !proof.scope.browserRun &&
    !proof.scope.leagueReferenceCompared,
  "Object component evidence incomplete or stale",
);
for (const [name, expected] of Object.entries(native.sources))
  requireThat(
    sha(await read(`${root}/tools/${name}`)) === expected,
    `Native object source changed: ${name}`,
  );
for (const [name, expected] of Object.entries(proof.sources))
  requireThat(
    sha(await read(`${root}/${name}`)) === expected,
    `WASM object source changed: ${name}`,
  );
for (const record of [native, proof])
  for (const [path, expected] of Object.entries(record.inputs))
    requireThat(
      sha(await read(path)) === expected,
      `Object input changed: ${path}`,
    );
for (const block of native.originalBlocks)
  requireThat(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Original object instruction changed",
  );
requireThat(
  proof.rows.length === native.cases.length,
  "Object observation coverage differs",
);
for (const [index, row] of proof.rows.entries()) {
  const c = native.cases[index];
  requireThat(
    [
      "case",
      "effectId",
      "kind",
      "sourceSequence",
      "graphSha256",
      "firstBits",
      "secondBits",
      "objects",
    ].every((key) => JSON.stringify(row[key]) === JSON.stringify(c[key])) &&
      row.observationSha256 ===
        sha(new TextEncoder().encode(JSON.stringify(c.observations))) &&
      row.stateSha256 ===
        sha(new TextEncoder().encode(JSON.stringify(c.state))) &&
      row.pendingCount === c.state.queue.length &&
      row.pendingCapacity === c.state.capacity &&
      row.readyFlags.length === c.objects &&
      row.readyFlags.every((flags) => flags === 0x84),
    `Object observation differs: ${index}`,
  );
}
const roots = proof.rows.filter((r) => r.kind === "prepared-root"),
  recorded = proof.rows.filter((r) => r.kind === "recorded-scalar-inputs"),
  stress = proof.rows.filter((r) => r.kind === "pending-queue-growth");
requireThat(
  roots.length === 876 &&
    new Set(roots.map((r) => r.effectId)).size === 876 &&
    recorded.length === 1107 &&
    stress.length === 1 &&
    stress[0].pendingCount === 17 &&
    stress[0].pendingCapacity === 19 &&
    proof.rows.reduce((n, r) => n + r.objects, 0) === proof.counts.objects &&
    proof.counts.objects * 0x238 * 3 === proof.counts.objectStageBytes &&
    proof.rows.length === proof.counts.cases,
  "Object corpus totals differ",
);
const build = await Bun.build({
  entrypoints: [`${root}/latest-vfx-objects.mjs`],
  target: "browser",
});
requireThat(
  build.success && build.outputs.length === 1,
  "Object browser-target build failed",
);
const paths = new Map();
for (const [name, source] of [
  ["vfx-objects-native.json", nativePath],
  ["vfx-objects-comparison.json", proofPath],
]) {
  const destination = `${assets}/evidence/${name}`;
  await Bun.write(destination, await read(source));
  paths.set(`/assets/evidence/${name}`, destination);
}
for (const name of ["latest-vfx-objects.png", "latest-vfx-objects.json"])
  paths.set(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
for (const name of ["latest-vfx-objects", "latest-vfx-system-assets"])
  paths.set(`/assets/${name}/package.json`, `${assets}/${name}/package.json`);
paths.set(
  "/assets/latest-effects/manifest.json",
  `${assets}/latest-effects/manifest.json`,
);
for (const [effectId, ref] of Object.entries(systems.systems)) {
  paths.set(
    `/assets/latest-vfx-system-assets/${ref.file}`,
    `${assets}/latest-vfx-system-assets/${ref.file}`,
  );
  paths.set(
    `/assets/latest-effects/${effects.definitions[effectId].file}`,
    `${assets}/latest-effects/${effects.definitions[effectId].file}`,
  );
}
for (const name of [
  "profile.json",
  "image.bin",
  "vfx-assets.json",
  "vfx-spawn.json",
])
  paths.set(
    `/assets/decoder-16.21-macos/${name}`,
    `${assets}/decoder-16.21-macos/${name}`,
  );
paths.set(
  "/assets/vendor/unicorn_x86_candidate.mjs",
  `${assets}/vendor/unicorn_x86_candidate.mjs`,
);
const visited = new Set();
async function include(file) {
  if (visited.has(file)) return;
  visited.add(file);
  paths.set(`/${file.slice(root.length + 1).replaceAll("\\", "/")}`, file);
  for (const match of (await Bun.file(file).text()).matchAll(
    /(?:from\s*|import\s*\()\s*["'](\.\.?\/[^"']+\.mjs)["']/g,
  ))
    await include(resolve(dirname(file), match[1]));
}
await include(`${root}/latest-vfx-objects.mjs`);
for (const name of ["README.md", "AV-FIDELITY-MAP.md"])
  paths.set(`/${name}`, `${root}/${name}`);
const files = await Promise.all(
    [...paths].map(async ([path, file]) => ({
      path,
      sha256: sha(await read(file)),
    })),
  ),
  checks = [];
for (const origin of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  let cursor = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, async () => {
      while (cursor < files.length) {
        const item = files[cursor++],
          response = await fetch(`${origin}${item.path}`, {
            signal: AbortSignal.timeout(30000),
          });
        requireThat(
          response.status === 200 &&
            sha(await response.arrayBuffer()) === item.sha256,
          `Object publication differs: ${origin}${item.path}`,
        );
        checks.push({ url: `${origin}${item.path}`, sha256: item.sha256 });
      }
    }),
  );
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
}
checks.sort((a, b) => a.url.localeCompare(b.url));
await Bun.write(
  `${cache}/research/vfx-objects-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      publisherSha256: sha(await read(import.meta.path)),
      comparisonSha256: sha(await read(proofPath)),
      imageSha256: visual.imageSha256,
      counts: proof.counts,
      scope: proof.scope,
      checks,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ matchedFiles: checks.length, counts: proof.counts }),
);
