import { resolve, dirname } from "node:path";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: publish-effect-removal.mjs <cache>");
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
const nativePath = `${cache}/research/effect-removal-native.json`,
  proofPath = `${cache}/research/effect-removal-comparison.json`,
  reportPath = `${cache}/research/latest-semantics-creations.json`,
  packagePath = `${assets}/latest-effect-removal/package.json`,
  visualPath = `${assets}/evidence/latest-effect-removal.json`;
const native = await json(nativePath),
  proof = await json(proofPath),
  meta = await json(packagePath),
  visual = await json(visualPath),
  report = await json(reportPath),
  image = await read(`${decoder}/image.bin`);
requireThat(
  meta.build === "16.21.829.8620" &&
    meta.protocol === "20e09df23c66b85e" &&
    meta.decoderImageSha256 === sha(image) &&
    native.packageSha256 === sha(await read(packagePath)) &&
    proof.packageSha256 === native.packageSha256 &&
    proof.nativeEvidenceSha256 === sha(await read(nativePath)) &&
    proof.reconstructionSha256 === sha(await read(reportPath)) &&
    visual.nativeEvidenceSha256 === proof.nativeEvidenceSha256 &&
    visual.comparisonSha256 === sha(await read(proofPath)) &&
    visual.imageSha256 ===
      sha(await read(`${assets}/evidence/latest-effect-removal.png`)) &&
    proof.mismatches.length === 0 &&
    proof.counts.packetChecks === 3755 &&
    proof.counts.mixedChecks === 512 &&
    proof.counts.routingChecks === 2048 &&
    proof.counts.missileJoins === 0 &&
    proof.counts.worldJoins === 0 &&
    proof.counts.creationIdsJoined === 911 &&
    proof.scope.mainDecoderSourceIntegrated &&
    !proof.scope.worldRegistryExecuted &&
    !proof.scope.typeCastExecuted &&
    !proof.scope.renderingIntegrated &&
    !proof.scope.browserRun &&
    JSON.stringify(visual.counts) === JSON.stringify(proof.counts),
  "Removal proof is incomplete or changed",
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
      `Stale removal input: ${path}`,
    );
requireThat(
  proof.inspectorSha256 ===
    sha(await read(`${root}/tools/inspect-effect-removal.mjs`)) &&
    visual.rendererSha256 ===
      sha(await read(`${root}/tools/render-effect-removal.py`)),
  "Removal observer/visual source changed",
);
for (const block of meta.sourceBlocks)
  requireThat(
    sha(image.subarray(block.startRva, block.endRva)) === block.sha256,
    "Original removal code changed",
  );
const seen = new Set();
for (const probe of native.routing) {
  const { reasonByte, initialObjectFlags, effectPresent } = probe,
    key = `${reasonByte}:${initialObjectFlags}:${effectPresent}`,
    flags = effectPresent
      ? (initialObjectFlags | (reasonByte === 61 ? 0x800 : 0x10000000)) >>> 0
      : initialObjectFlags;
  requireThat(
    !seen.has(key) &&
      Number.isInteger(reasonByte) &&
      reasonByte >= 0 &&
      reasonByte <= 255 &&
      [0, 0x4000, 0xffffffff, 0x10000000].includes(initialObjectFlags) &&
      typeof effectPresent === "boolean" &&
      probe.objectFlags === flags &&
      probe.entityEffectPointer === 0 &&
      probe.queued === Number(effectPresent) &&
      probe.rootFlags ===
        (effectPresent ? (flags & 0x10000000 ? 0x82 : 0xa0) : 0),
    "Removal mode/flag composition differs",
  );
  seen.add(key);
}
requireThat(
  seen.size === 2048,
  "Incomplete removal reason/prior-flag/presence coverage",
);
const bins = { 61: Array(60).fill(0), 62: Array(60).fill(0) },
  ids = new Set();
for (const record of native.records) {
  requireThat(
    record.reasonByte in bins &&
      record.time >= 0 &&
      record.time <= 120 &&
      record.requestedFlagMask ===
        (record.reasonByte === 61 ? 0x800 : 0x10000000),
    "Unexpected removal record",
  );
  bins[record.reasonByte][Math.min(59, Math.floor(record.time / 2))]++;
  ids.add(record.entityId);
}
requireThat(
  JSON.stringify(bins) === JSON.stringify(visual.bins) &&
    ids.size === 1176 &&
    report.effectRemovals.length === native.records.length,
  "Replay removal visual differs from native records",
);
const worker = await Bun.file(`${root}/structural-check-worker.mjs`).text(),
  recon = await Bun.file(`${root}/latest-reconstruction.mjs`).text();
requireThat(
  worker.includes("/assets/latest-effect-removal/package.json") &&
    worker.includes("effectRemovalBytes") &&
    recon.includes("createLatestEffectRemovalReader") &&
    recon.includes("effectRemovals.push"),
  "Main decoder removal source is disconnected",
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
  "Updated reconstruction worker failed browser-target build",
);
const paths = new Map(),
  add = (path, file) => paths.set(path, file);
for (const [name, path] of [
  ["effect-removal-native.json", nativePath],
  ["effect-removal-comparison.json", proofPath],
  ["latest-semantics-creations.json", reportPath],
]) {
  await Bun.write(`${assets}/evidence/${name}`, await read(path));
  add(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
}
for (const name of ["latest-effect-removal.png", "latest-effect-removal.json"])
  add(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
add("/assets/latest-effect-removal/package.json", packagePath);
for (const name of [
  "profile.json",
  "image.bin",
  "constructors.bin",
  "field-codecs.json",
])
  add(`/assets/decoder-16.21-macos/${name}`, `${decoder}/${name}`);
for (const name of [
  "unicorn_x86_candidate.mjs",
  "unicorn_x86_candidate.json",
  "fzstd.mjs",
])
  add(`/assets/vendor/${name}`, `${assets}/vendor/${name}`);
const visited = new Set();
async function includeModule(file) {
  if (visited.has(file)) return;
  visited.add(file);
  add(`/${file.slice(root.length + 1).replaceAll("\\", "/")}`, file);
  for (const match of (await Bun.file(file).text()).matchAll(
    /(?:from\s*|import\s*\()\s*["'](\.\.?\/[^"']+\.mjs)["']/g,
  ))
    await includeModule(resolve(dirname(file), match[1]));
}
await includeModule(`${root}/structural-check-worker.mjs`);
for (const name of ["README.md", "AV-FIDELITY-MAP.md"])
  add(`/${name}`, `${root}/${name}`);
const results = [];
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
])
  for (const [path, file] of paths) {
    const response = await fetch(`${base}${path}`, {
        signal: AbortSignal.timeout(30000),
      }),
      expected = sha(await read(file));
    requireThat(
      response.status === 200 && sha(await response.arrayBuffer()) === expected,
      `Removal publication differs: ${base}${path}`,
    );
    results.push({ base, path, status: response.status, sha256: expected });
  }
await Bun.write(
  `${cache}/research/effect-removal-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "particle-entity-removal-publication",
      build: meta.build,
      publisherSha256: sha(await read(import.meta.path)),
      packageSha256: proof.packageSha256,
      comparisonSha256: visual.comparisonSha256,
      visualSha256: sha(await read(visualPath)),
      browserBuildSha256: sha(await build.outputs[0].arrayBuffer()),
      counts: proof.counts,
      results,
      scope: {
        mainDecoderSourceIntegrated: true,
        browserTargetBuild: true,
        browserRun: false,
        renderingIntegrated: false,
        productionDeployment: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ matchedFiles: results.length, counts: proof.counts }),
);
