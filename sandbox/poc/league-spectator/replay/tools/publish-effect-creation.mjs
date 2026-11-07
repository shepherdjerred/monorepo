// Publish checked creation evidence through the existing local/Tailscale preview.
import { resolve, dirname } from "node:path";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: publish-effect-creation.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`;
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  read = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer()),
  json = async (path) => JSON.parse(new TextDecoder().decode(await read(path)));
const requireThat = (ok, message) => {
  if (!ok) throw Error(message);
};
const nativePath = `${cache}/research/effect-creation-native.json`,
  proofPath = `${cache}/research/effect-creation-comparison.json`,
  reportPath = `${cache}/research/latest-semantics-creations.json`,
  packagePath = `${assets}/latest-effect-creation/package.json`,
  visualPath = `${assets}/evidence/latest-effect-creation.json`;
const native = await json(nativePath),
  proof = await json(proofPath),
  report = await json(reportPath),
  meta = await json(packagePath),
  visual = await json(visualPath),
  image = await read(`${decoder}/image.bin`);
requireThat(
  meta.build === "16.21.829.8620" &&
    meta.protocol === "20e09df23c66b85e" &&
    sha(image) === meta.decoderImageSha256 &&
    sha(await read(packagePath)) === native.packageSha256 &&
    native.packageSha256 === proof.packageSha256 &&
    proof.nativeEvidenceSha256 === sha(await read(nativePath)) &&
    proof.reconstructionSha256 === sha(await read(reportPath)) &&
    visual.reconstructionSha256 === proof.reconstructionSha256 &&
    visual.comparisonSha256 === sha(await read(proofPath)) &&
    visual.imageSha256 ===
      sha(await read(`${assets}/evidence/latest-effect-creation.png`)) &&
    proof.inspectorSha256 ===
      sha(await read(`${root}/tools/inspect-effect-creation.mjs`)) &&
    visual.rendererSha256 ===
      sha(await read(`${root}/tools/render-effect-creation.py`)) &&
    JSON.stringify(visual.counts) === JSON.stringify(proof.counts) &&
    proof.mismatches.length === 0 &&
    proof.scope.mainDecoderSourceIntegrated &&
    !proof.scope.worldRegistryExecuted &&
    !proof.scope.factoryExecuted &&
    !proof.scope.mapOriginConversionExecuted &&
    !proof.scope.attachmentPoseExecuted &&
    !proof.scope.renderingIntegrated &&
    !proof.scope.browserRun &&
    !proof.scope.leagueReferenceCompared,
  "Creation evidence missing or changed",
);
for (const [name, expected] of Object.entries(native.sources))
  requireThat(
    sha(await read(`${root}/tools/${name}`)) === expected,
    `Stale native source: ${name}`,
  );
for (const [name, expected] of Object.entries(proof.sources))
  requireThat(
    sha(await read(`${root}/${name}`)) === expected,
    `Stale browser source: ${name}`,
  );
for (const record of [native, proof])
  for (const [path, expected] of Object.entries(record.inputs))
    requireThat(
      sha(await read(path)) === expected,
      `Stale creation input: ${path}`,
    );
for (const block of meta.sourceBlocks)
  requireThat(
    sha(image.subarray(block.startRva, block.endRva)) === block.sha256,
    "Creation original code changed",
  );
const counts = proof.counts,
  bindingCounts = {},
  requestCounts = {},
  joined = new Set(),
  created = new Map(
    report.effectCreations.map((record) => [record.entityId, record]),
  ),
  effects = await json(`${assets}/latest-effects/manifest.json`),
  heroes = new Map(report.heroes.map((hero) => [hero.entityId, hero]));
for (const [index, binding] of proof.bindings.entries()) {
  const record = report.effectCreations[index];
  requireThat(
    binding.entityId === record.entityId && binding.creationSequence === index,
    "Binding order changed",
  );
  bindingCounts[binding.status] = (bindingCounts[binding.status] ?? 0) + 1;
  if (binding.status === "prepared-context-resource") {
    const hero = heroes.get(record.resourceContextEntityId),
      actor = `champions/${hero.champion.toLowerCase()}/${hero.skinId}`,
      resource =
        effects.actors[actor].resources[
          record.resourceKey.toString(16).padStart(8, "0")
        ];
    requireThat(
      binding.actorKey === actor &&
        resource.status === "prepared-definition" &&
        resource.effectId === binding.effectId &&
        effects.definitions[binding.effectId],
      "Prepared binding escaped explicit context skin",
    );
  }
}
for (const [index, removal] of report.effectRemovals.entries()) {
  const creation = created.get(removal.entityId),
    request = proof.removalRequests[index];
  let status = "creation-not-observed";
  if (creation) {
    status =
      removal.time > creation.time ||
      (removal.time === creation.time &&
        removal.transportSequence >= creation.transportSequence)
        ? "creation-before-removal-request"
        : "removal-before-observed-creation";
    if (status === "creation-before-removal-request")
      joined.add(creation.entityId);
  }
  requireThat(
    request.entityId === removal.entityId &&
      request.removalSequence === removal.removalSequence &&
      request.creationSequence === (creation?.creationSequence ?? null) &&
      request.status === status &&
      request.time === removal.time &&
      request.reasonByte === removal.reasonByte,
    "Creation/removal ordering changed",
  );
  requestCounts[status] = (requestCounts[status] ?? 0) + 1;
}
const bins = { prepared: Array(60).fill(0), unresolved: Array(60).fill(0) };
for (const [index, record] of report.effectCreations.entries()) {
  requireThat(
    record.time >= 0 &&
      record.time <= 120 &&
      !record.positionFields.worldPositionResolved &&
      !record.positionFields.attachmentOverrideResolved,
    "Unexpected creation position/window",
  );
  const kind =
    proof.bindings[index].status === "prepared-context-resource"
      ? "prepared"
      : "unresolved";
  bins[kind][Math.min(59, Math.floor(record.time / 2))]++;
}
for (const span of visual.requestSpans) {
  const record = report.effectCreations[span.creationSequence],
    requests = proof.removalRequests.filter(
      (request) =>
        request.creationSequence === span.creationSequence &&
        request.status === "creation-before-removal-request",
    );
  requireThat(
    span.entityId === record.entityId &&
      span.start === record.time &&
      span.firstRemovalRequest === requests[0]?.time,
    "Visual request span changed",
  );
}
requireThat(
  counts.packetChecks === native.counts.packets &&
    counts.entryChecks === report.effectCreations.length &&
    counts.mixedChecks === native.mixedProbes.length &&
    counts.uniqueIds === created.size &&
    counts.createdIdsWithRemoval === joined.size &&
    proof.bindings.length === report.effectCreations.length &&
    JSON.stringify(bindingCounts) === JSON.stringify(counts.bindingCounts) &&
    JSON.stringify(requestCounts) ===
      JSON.stringify(counts.removalRequestCounts) &&
    JSON.stringify(bins.prepared) === JSON.stringify(visual.preparedBins) &&
    JSON.stringify(bins.unresolved) === JSON.stringify(visual.unresolvedBins),
  "Creation summaries differ from records",
);
const worker = await Bun.file(`${root}/structural-check-worker.mjs`).text(),
  reconstruction = await Bun.file(`${root}/latest-reconstruction.mjs`).text();
requireThat(
  worker.includes("/assets/latest-effect-creation/package.json") &&
    worker.includes("effectCreationBytes") &&
    reconstruction.includes("createLatestEffectCreationReader") &&
    reconstruction.includes("effectCreations.push"),
  "Worker creation stream disconnected",
);
const build = await Bun.build({
  entrypoints: [`${root}/structural-check-worker.mjs`],
  target: "browser",
  plugins: [
    {
      name: "served-assets",
      setup(builder) {
        builder.onResolve({ filter: /^\/assets\// }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
  ],
});
requireThat(
  build.success && build.outputs.length === 1,
  "Creation worker browser-target build failed",
);
const paths = new Map();
for (const [name, path] of [
  ["effect-creation-native.json", nativePath],
  ["effect-creation-comparison.json", proofPath],
  ["latest-semantics-creations.json", reportPath],
]) {
  await Bun.write(`${assets}/evidence/${name}`, await read(path));
  paths.set(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
}
for (const name of [
  "latest-effect-creation.png",
  "latest-effect-creation.json",
])
  paths.set(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
paths.set("/assets/latest-effect-creation/package.json", packagePath);
paths.set(
  "/assets/latest-effect-removal/package.json",
  `${assets}/latest-effect-removal/package.json`,
);
for (const name of [
  "profile.json",
  "image.bin",
  "constructors.bin",
  "field-codecs.json",
])
  paths.set(`/assets/decoder-16.21-macos/${name}`, `${decoder}/${name}`);
for (const name of [
  "unicorn_x86_candidate.mjs",
  "unicorn_x86_candidate.json",
  "fzstd.mjs",
])
  paths.set(`/assets/vendor/${name}`, `${assets}/vendor/${name}`);
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
await includeModule(`${root}/structural-check-worker.mjs`);
for (const name of ["README.md", "AV-FIDELITY-MAP.md"])
  paths.set(`/${name}`, `${root}/${name}`);
const checks = [];
for (const origin of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
])
  for (const [path, file] of paths) {
    const response = await fetch(`${origin}${path}`, {
        signal: AbortSignal.timeout(30000),
      }),
      expected = sha(await read(file));
    requireThat(
      response.status === 200 && sha(await response.arrayBuffer()) === expected,
      `Creation publication differs: ${origin}${path}`,
    );
    checks.push({ url: `${origin}${path}`, sha256: expected });
  }
await Bun.write(
  `${cache}/research/effect-creation-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      publisherSha256: sha(await read(import.meta.path)),
      comparisonSha256: sha(await read(proofPath)),
      imageSha256: visual.imageSha256,
      counts,
      scope: proof.scope,
      checks,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ matchedFiles: checks.length, counts }));
