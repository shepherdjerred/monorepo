// Publish complete static roots; does not claim runtime or rendering admission.
import { resolve, dirname } from "node:path";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: publish-vfx-system-assets.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  systems = `${assets}/latest-vfx-system-assets`,
  effects = `${assets}/latest-effects`,
  decoder = `${assets}/decoder-16.21-macos`;
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  read = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer()),
  json = async (path) => JSON.parse(new TextDecoder().decode(await read(path)));
const requireThat = (ok, message) => {
  if (!ok) throw Error(message);
};
const nativePath = `${cache}/research/vfx-system-assets-native.json`,
  proofPath = `${cache}/research/vfx-system-assets-comparison.json`,
  visualPath = `${assets}/evidence/latest-vfx-system-assets.json`;
const native = await json(nativePath),
  proof = await json(proofPath),
  visual = await json(visualPath),
  meta = await json(`${systems}/package.json`),
  manifest = await json(`${effects}/manifest.json`),
  image = await read(`${decoder}/image.bin`);
requireThat(
  meta.build === "16.21.829.8620" &&
    meta.protocol === "20e09df23c66b85e" &&
    meta.decoderImageSha256 === sha(image) &&
    native.packageSha256 === sha(await read(`${systems}/package.json`)) &&
    proof.packageSha256 === native.packageSha256 &&
    proof.nativeEvidenceSha256 === sha(await read(nativePath)) &&
    proof.inspectorSha256 ===
      sha(await read(`${root}/tools/inspect-vfx-system-assets.mjs`)) &&
    visual.comparisonSha256 === sha(await read(proofPath)) &&
    visual.rendererSha256 ===
      sha(await read(`${root}/tools/render-vfx-system-assets.py`)) &&
    visual.imageSha256 ===
      sha(await read(`${assets}/evidence/latest-vfx-system-assets.png`)) &&
    JSON.stringify(visual.counts) === JSON.stringify(proof.counts) &&
    proof.mismatches.length === 0 &&
    proof.counts.nativeIgnoredFields === 0 &&
    proof.counts.nativeTypeMismatches === 0 &&
    proof.counts.pendingLinkFixups === 0 &&
    proof.counts.mathCalls === 0 &&
    proof.scope.completeSerializedRoot &&
    proof.scope.originalPostloadCallbacks &&
    proof.scope.allPreparedDefinitionsCovered &&
    proof.scope.parentOverridesPreserved &&
    !proof.scope.runtimeFactoryExecuted &&
    !proof.scope.resourceAcquisitionExecuted &&
    !proof.scope.mainViewerIntegrated &&
    !proof.scope.browserRun &&
    !proof.scope.leagueReferenceCompared,
  "Complete-system asset proof incomplete or stale",
);
for (const [name, expected] of Object.entries(native.sources))
  requireThat(
    sha(await read(`${root}/tools/${name}`)) === expected,
    `Native system source changed: ${name}`,
  );
for (const [name, expected] of Object.entries(proof.sources))
  requireThat(
    sha(await read(`${root}/${name}`)) === expected,
    `Browser system source changed: ${name}`,
  );
for (const record of [native, proof])
  for (const [path, expected] of Object.entries(record.inputs))
    requireThat(
      sha(await read(path)) === expected,
      `System asset input changed: ${path}`,
    );
for (const block of native.originalBlocks)
  requireThat(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "System asset original code changed",
  );
const totals = {
    systems: proof.rows.length,
    serializedFields: 0,
    objectVisits: 0,
    callbackVisits: 0,
    directComplexEmitters: 0,
    directSimpleEmitters: 0,
    emitterDefinitionVisits: 0,
    heapBytes: 0,
  },
  actors = new Map();
for (const row of proof.rows) {
  const ref = meta.systems[row.effectId],
    graphBytes = await read(`${systems}/${ref.file}`),
    graph = JSON.parse(new TextDecoder().decode(graphBytes));
  requireThat(
    sha(graphBytes) === ref.sha256 &&
      row.graphSha256 === ref.sha256 &&
      ref.definitionSha256 === manifest.definitions[row.effectId].sha256 &&
      sha(Buffer.from(graph.objectHex, "hex")) === row.rootSha256 &&
      sha(Buffer.from(graph.heapHex, "hex")) === row.heapSha256 &&
      row.visits === graph.visits.length &&
      graph.pendingLinkFixups === 0 &&
      graph.mathCalls.length === 0 &&
      graph.ignored.length === 0 &&
      graph.mismatched.length === 0,
    "Complete-system graph differs from checked bytes",
  );
  totals.serializedFields += row.serializedFields;
  totals.objectVisits += row.visits;
  totals.callbackVisits += row.callbacks;
  totals.directComplexEmitters += row.directComplexEmitters;
  totals.directSimpleEmitters += row.directSimpleEmitters;
  totals.emitterDefinitionVisits += row.emitterDefinitionVisits;
  totals.heapBytes += row.heapBytes;
  const actor = row.effectId.slice(0, row.effectId.lastIndexOf("/"));
  if (!actors.has(actor))
    actors.set(actor, {
      actor,
      systems: 0,
      complexEmitters: 0,
      simpleEmitters: 0,
    });
  const aggregate = actors.get(actor);
  aggregate.systems++;
  aggregate.complexEmitters += row.directComplexEmitters;
  aggregate.simpleEmitters += row.directSimpleEmitters;
}
for (const [name, value] of Object.entries(totals))
  requireThat(
    proof.counts[name] === value,
    `System asset total differs: ${name}`,
  );
requireThat(
  JSON.stringify(
    [...actors.values()].sort((a, b) => a.actor.localeCompare(b.actor)),
  ) === JSON.stringify(visual.actors),
  "System visual differs from prepared actors",
);
const build = await Bun.build({
  entrypoints: [`${root}/latest-vfx-system-assets.mjs`],
  target: "browser",
});
requireThat(
  build.success && build.outputs.length === 1,
  "Complete-system asset browser-target build failed",
);
const paths = new Map();
for (const [name, path] of [
  ["vfx-system-assets-native.json", nativePath],
  ["vfx-system-assets-comparison.json", proofPath],
]) {
  await Bun.write(`${assets}/evidence/${name}`, await read(path));
  paths.set(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
}
for (const name of [
  "latest-vfx-system-assets.png",
  "latest-vfx-system-assets.json",
])
  paths.set(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
paths.set(
  "/assets/latest-vfx-system-assets/package.json",
  `${systems}/package.json`,
);
paths.set("/assets/latest-effects/manifest.json", `${effects}/manifest.json`);
for (const [effectId, ref] of Object.entries(meta.systems)) {
  paths.set(
    `/assets/latest-vfx-system-assets/${ref.file}`,
    `${systems}/${ref.file}`,
  );
  const effectRef = manifest.definitions[effectId];
  paths.set(
    `/assets/latest-effects/${effectRef.file}`,
    `${effects}/${effectRef.file}`,
  );
}
for (const name of ["profile.json", "vfx-assets.json"])
  paths.set(`/assets/decoder-16.21-macos/${name}`, `${decoder}/${name}`);
const visited = new Set();
async function includeModule(file) {
  if (visited.has(file)) return;
  visited.add(file);
  paths.set(`/${file.slice(root.length + 1).replaceAll("\\", "/")}`, file);
  for (const match of (await Bun.file(file).text()).matchAll(
    /(?:from\s*|import\s*\()\s*["'](\.\.?\/[^"']+\.mjs)["']/g,
  ))
    await includeModule(resolve(dirname(file), match[1]));
}
await includeModule(`${root}/latest-vfx-system-assets.mjs`);
for (const name of ["README.md", "AV-FIDELITY-MAP.md"])
  paths.set(`/${name}`, `${root}/${name}`);
const expectedFiles = await Promise.all(
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
      while (cursor < expectedFiles.length) {
        const item = expectedFiles[cursor++],
          response = await fetch(`${origin}${item.path}`, {
            signal: AbortSignal.timeout(30000),
          });
        requireThat(
          response.status === 200 &&
            sha(await response.arrayBuffer()) === item.sha256,
          `System asset publication differs: ${origin}${item.path}`,
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
  `${cache}/research/vfx-system-assets-publication.json`,
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
