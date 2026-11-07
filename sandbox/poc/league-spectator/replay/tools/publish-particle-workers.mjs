// Exact served source and component evidence, without browser-acceptance claims.
import { resolve } from "node:path";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: publish-particle-workers.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  comparisonBytes = await raw(
    `${cache}/research/particle-workers-comparison.json`,
  ),
  comparison = JSON.parse(new TextDecoder().decode(comparisonBytes)),
  quad = await read(`${cache}/research/quad-pool-renderer-comparison.json`),
  trail = await read(`${cache}/research/trail-renderer-comparison.json`);
check(
  comparison.kind === "particle-worker-frame-comparison" &&
    comparison.mismatches === 0 &&
    comparison.counts.frames === 88 &&
    comparison.counts.sampleCalls === 21450 &&
    comparison.counts.geometryDigestChecks === 10020 &&
    comparison.counts.cancelChecks === 1 &&
    comparison.counts.failureChecks === 3 &&
    comparison.counts.stalePresentationChecks === 1 &&
    comparison.counts.reloadResetChecks === 1 &&
    comparison.counts.imageTransferChecks === 1 &&
    comparison.scope.actualModuleWorkers &&
    comparison.scope.browserWorkerBundleBuilt &&
    comparison.scope.sourceIntegrated &&
    !comparison.scope.browserRun &&
    !comparison.scope.browserResponsivenessEstablished &&
    quad.scope.browserBundleBuilt &&
    trail.scope.browserBundleBuilt &&
    !quad.scope.browserRun &&
    !trail.scope.browserRun,
  "Incomplete particle worker/frame evidence",
);
for (const record of [comparison, quad, trail]) {
  for (const [path, expected] of Object.entries(record.inputs))
    check(sha(await raw(path)) === expected, `Worker input changed: ${path}`);
  for (const [name, expected] of Object.entries(record.sources))
    check(
      sha(await raw(`${root}/${name}`)) === expected,
      `Worker source changed: ${name}`,
    );
}
const bundle = await raw(
  `${cache}/research/particle-worker-browser.bundle.mjs`,
);
check(
  sha(bundle) === comparison.browserWorkerBundleSha256,
  "Particle worker browser bundle differs",
);
const files = new Map();
for (const [name, bytes] of [
  ["latest-particle-workers.json", comparisonBytes],
  ["latest-particle-worker-browser.bundle.mjs", bundle],
  [
    "latest-particle-workers-quad-renderer.json",
    await raw(`${cache}/research/quad-pool-renderer-comparison.json`),
  ],
  [
    "latest-particle-workers-trail-renderer.json",
    await raw(`${cache}/research/trail-renderer-comparison.json`),
  ],
]) {
  const path = `${assets}/evidence/${name}`;
  await Bun.write(path, bytes);
  files.set(`/assets/evidence/${name}`, { path, sha256: sha(bytes) });
}
for (const name of [
  "latest-particle-worker.mjs",
  "latest-particle-worker-client.mjs",
  "latest-particle-frame-gate.mjs",
  "latest-trail-renderer.mjs",
  "latest-quad-pool-renderer.mjs",
  "latest-viewer.mjs",
]) {
  const path = `${root}/${name}`;
  files.set(`/${name}`, { path, sha256: sha(await raw(path)) });
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
    check(
      response.status === 200 &&
        sha(new Uint8Array(await response.arrayBuffer())) === ref.sha256,
      `Worker preview bytes differ: ${base + url}`,
    );
    httpChecks++;
  }
await Bun.write(
  `${cache}/research/particle-workers-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "particle-worker-preview-publication",
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
    hostEventLoop: comparison.hostEventLoop,
  }),
);
