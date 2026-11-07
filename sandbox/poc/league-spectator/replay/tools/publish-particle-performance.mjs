// Publish CPU-only evidence and verify all new preview runtime dependencies.
import { resolve } from "node:path";
import { UNICORN_BULK_PACKAGE_SHA } from "../latest-unicorn-bulk.mjs";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: publish-particle-performance.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  requireValue = (v, m) => {
    if (!v) throw Error(m);
  },
  comparisonBytes = await raw(
    `${cache}/research/particle-bulk-comparison.json`,
  ),
  comparison = JSON.parse(new TextDecoder().decode(comparisonBytes)),
  proofBytes = await raw(`${cache}/research/unicorn-bulk-inspection.json`),
  proof = JSON.parse(new TextDecoder().decode(proofBytes)),
  summary = await read(`${assets}/evidence/latest-particle-performance.json`),
  packageBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
  meta = JSON.parse(new TextDecoder().decode(packageBytes)),
  renderer = await read(`${cache}/research/quad-pool-renderer-comparison.json`);
requireValue(
  comparison.kind === "particle-playback-bulk-comparison" &&
    comparison.mismatches === 0 &&
    comparison.counts.frames === 88 &&
    comparison.counts.samples === 21450 &&
    comparison.counts.geometryDigestChecks === 10020 &&
    comparison.scope.cpuOnly &&
    !comparison.scope.browserPerformanceEstablished &&
    !comparison.scope.realTimeEstablished &&
    proof.mismatches === 0 &&
    proof.counts.comparisons === 17 &&
    proof.counts.matchingNativeErrors === 3 &&
    proof.counts.heapGrowthChecks === 1 &&
    proof.counts.ownedCopyChecks === 1 &&
    proof.counts.corruptBinaryRejections === 1 &&
    summary.comparisonSha256 === sha(comparisonBytes) &&
    sha(packageBytes) === UNICORN_BULK_PACKAGE_SHA &&
    renderer.scope.browserBundleBuilt &&
    !renderer.scope.browserRun,
  "Incomplete particle runtime/performance evidence",
);
for (const record of [comparison, proof])
  for (const [path, expected] of Object.entries(record.inputs))
    requireValue(
      sha(await raw(path)) === expected,
      `Particle performance input changed: ${path}`,
    );
for (const [name, expected] of Object.entries(renderer.sources))
  requireValue(
    sha(await raw(`${root}/${name}`)) === expected,
    `Particle renderer source changed: ${name}`,
  );
for (const [path, expected] of [
  [`${root}/latest-unicorn-bulk.mjs`, proof.adapterSha256],
  [`${import.meta.dir}/inspect-unicorn-bulk.mjs`, proof.inspectorSha256],
  [
    `${import.meta.dir}/compare-particle-profiles.mjs`,
    comparison.comparatorSha256,
  ],
  [`${import.meta.dir}/render-particle-performance.py`, summary.rendererSha256],
  [`${import.meta.dir}/prepare-unicorn-bulk.mjs`, meta.extractorSha256],
])
  requireValue(
    sha(await raw(path)) === expected,
    `Particle memory producer/verifier changed: ${path}`,
  );
requireValue(
  sha(await raw(`${assets}/latest-unicorn-bulk/${meta.file}`)) ===
    meta.wasmSha256,
  "Bulk WASM changed",
);
requireValue(
  sha(await raw(`${assets}/evidence/latest-particle-performance.png`)) ===
    summary.imageSha256,
  "Particle performance image changed",
);
const files = new Map();
for (const [name, bytes] of [
  ["comparison", comparisonBytes],
  ["memory-inspection", proofBytes],
  [
    "baseline-profile",
    await raw(`${cache}/research/particle-profile-baseline.json`),
  ],
  ["bulk-profile", await raw(`${cache}/research/particle-profile-bulk.json`)],
]) {
  const file = `latest-particle-performance-${name}.json`,
    path = `${assets}/evidence/${file}`;
  await Bun.write(path, bytes);
  files.set(`/assets/evidence/${file}`, { path, sha256: sha(bytes) });
}
for (const file of [
  "evidence/latest-particle-performance.png",
  "evidence/latest-particle-performance.json",
  "latest-unicorn-bulk/package.json",
  `latest-unicorn-bulk/${meta.file}`,
]) {
  const path = `${assets}/${file}`;
  files.set(`/assets/${file}`, { path, sha256: sha(await raw(path)) });
}
for (const file of [
  "latest-unicorn-bulk.mjs",
  "latest-trail-renderer.mjs",
  "latest-quad-pool-renderer.mjs",
  "latest-viewer.mjs",
]) {
  const path = `${root}/${file}`;
  files.set(`/${file}`, { path, sha256: sha(await raw(path)) });
}
let httpChecks = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
])
  for (const [url, ref] of files) {
    const response = await fetch(base + url, {
      signal: AbortSignal.timeout(30000),
    });
    requireValue(
      response.status === 200 &&
        sha(new Uint8Array(await response.arrayBuffer())) === ref.sha256,
      `Particle runtime/evidence preview bytes differ: ${base + url}`,
    );
    httpChecks++;
  }
await Bun.write(
  `${cache}/research/particle-performance-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "particle-performance-preview-publication",
      httpChecks,
      files: Object.fromEntries(files),
      counts: comparison.counts,
      scope: comparison.scope,
      publisherSha256: sha(await raw(import.meta.path)),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    httpChecks,
    files: files.size,
    counts: comparison.counts,
    ratios: comparison.ratios,
  }),
);
