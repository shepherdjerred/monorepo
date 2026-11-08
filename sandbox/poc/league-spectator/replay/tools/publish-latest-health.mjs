// Source, native/WASM/state evidence and HTTP delivery; no browser UI claim.
import { resolve, dirname } from "node:path";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: publish-latest-health.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  read = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  json = async (p) => JSON.parse(new TextDecoder().decode(await read(p))),
  requireThat = (v, m) => {
    if (!v) throw Error(m);
  };
const proofPath = `${cache}/research/latest-health-comparison.json`,
  nativePath = `${cache}/research/latest-replication-native.json`,
  proof = await json(proofPath),
  native = await json(nativePath),
  visual = await json(`${assets}/evidence/latest-health.json`),
  meta = await json(`${assets}/latest-replication/package.json`),
  image = await read(`${assets}/decoder-16.21-macos/image.bin`),
  report = await json(`${cache}/research/latest-semantics-health.json`),
  c = proof.counts;
requireThat(
  proof.packageSha256 ===
    sha(await read(`${assets}/latest-replication/package.json`)) &&
    native.packageSha256 === proof.packageSha256 &&
    meta.decoderImageSha256 === sha(image) &&
    meta.build === report.build &&
    meta.protocol === report.protocol &&
    report.replicationPackageSha256 === proof.packageSha256 &&
    proof.inspectorSha256 ===
      sha(await read(`${root}/tools/inspect-latest-health.mjs`)) &&
    native.preparerSha256 ===
      sha(await read(`${root}/tools/prepare-latest-replication.py`)) &&
    visual.comparisonSha256 === sha(await read(proofPath)) &&
    visual.rendererSha256 ===
      sha(await read(`${root}/tools/render-latest-health.mjs`)) &&
    visual.imageSha256 ===
      sha(await read(`${assets}/evidence/latest-health.png`)) &&
    visual.svgSha256 ===
      sha(await read(`${assets}/evidence/latest-health.svg`)) &&
    JSON.stringify(visual.counts) === JSON.stringify(c) &&
    c.packetChecks === native.counts.packets &&
    c.prefixChecks === native.counts.championHealthGroups &&
    c.nativePrefixBytes === native.counts.nativePrefixBytes &&
    c.healthUpdates === report.healthUpdates.length &&
    c.healthUpdates === 1259 &&
    c.stateChecks === 6590 &&
    c.reverseSeekChecks === 659 &&
    c.hiddenDeathChecks === 8 &&
    c.respawnChecks === 8 &&
    c.legacyFields === 28 &&
    proof.scope.mainViewerSourceIntegrated &&
    !proof.scope.browserRun &&
    !proof.scope.leagueAvCompared &&
    !proof.scope.shieldSemanticsVerified &&
    !proof.scope.layoutReferenceVerified,
  "Latest health evidence incomplete or stale",
);
for (const [name, h] of Object.entries(proof.sources))
  requireThat(
    sha(await read(`${root}/${name}`)) === h,
    `Health source changed: ${name}`,
  );
for (const record of [proof, native])
  for (const [p, h] of Object.entries(record.inputs))
    requireThat(sha(await read(p)) === h, `Health input changed: ${p}`);
for (const block of native.originalBlocks)
  requireThat(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Native health instructions changed",
  );
const build = await Bun.build({
  entrypoints: [
    `${root}/latest-viewer.mjs`,
    `${root}/structural-check-worker.mjs`,
  ],
  target: "browser",
  external: ["three", "/assets/*"],
});
requireThat(
  build.success && build.outputs.length === 2,
  "Health viewer/worker browser-target build failed",
);
const paths = new Map(),
  visited = new Set();
async function include(file) {
  if (visited.has(file)) return;
  visited.add(file);
  paths.set(`/${file.slice(root.length + 1).replaceAll("\\", "/")}`, file);
  for (const m of (await Bun.file(file).text()).matchAll(
    /(?:from\s*|import\s*\()\s*["'](\.\.?\/[^"']+\.mjs)["']/g,
  ))
    await include(resolve(dirname(file), m[1]));
}
await include(`${root}/latest-viewer.mjs`);
await include(`${root}/structural-check-worker.mjs`);
for (const name of ["latest.html", "README.md", "AV-FIDELITY-MAP.md"])
  paths.set(`/${name}`, `${root}/${name}`);
paths.set(
  "/assets/latest-replication/package.json",
  `${assets}/latest-replication/package.json`,
);
for (const name of [
  "latest-health.png",
  "latest-health.svg",
  "latest-health.json",
])
  paths.set(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
for (const name of [
  "latest-health-comparison.json",
  "latest-replication-native.json",
  "latest-semantics-health.json",
]) {
  const dest = `${assets}/evidence/${name}`;
  await Bun.write(dest, await read(`${cache}/research/${name}`));
  paths.set(`/assets/evidence/${name}`, dest);
}
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
    Array.from({ length: 6 }, async () => {
      while (cursor < files.length) {
        const item = files[cursor++],
          response = await fetch(`${origin}${item.path}`, {
            signal: AbortSignal.timeout(30000),
          });
        requireThat(
          response.status === 200 &&
            sha(await response.arrayBuffer()) === item.sha256,
          `Health HTTP delivery differs: ${origin}${item.path}`,
        );
        checks.push({ url: `${origin}${item.path}`, sha256: item.sha256 });
      }
    }),
  );
  for (const r of results) if (r.status === "rejected") throw r.reason;
}
checks.sort((a, b) => a.url.localeCompare(b.url));
await Bun.write(
  `${cache}/research/latest-health-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      publisherSha256: sha(await read(import.meta.path)),
      comparisonSha256: sha(await read(proofPath)),
      imageSha256: visual.imageSha256,
      counts: c,
      scope: proof.scope,
      checks,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ matchedFiles: checks.length, counts: c }));
