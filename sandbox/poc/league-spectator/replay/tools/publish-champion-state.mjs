import { resolve, dirname } from "node:path";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: publish-champion-state.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  read = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  json = async (p) => JSON.parse(new TextDecoder().decode(await read(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  };
const nativePath = `${cache}/research/champion-state-native.json`,
  proofPath = `${cache}/research/champion-state-comparison.json`,
  native = await json(nativePath),
  proof = await json(proofPath),
  visual = await json(`${assets}/evidence/latest-champion-state.json`),
  report = await json(`${cache}/research/latest-semantics-champion-state.json`),
  meta = await json(`${assets}/latest-champion-state/package.json`),
  image = await read(`${assets}/decoder-16.21-macos/image.bin`),
  c = proof.counts;
check(
  proof.packageSha256 ===
    sha(await read(`${assets}/latest-champion-state/package.json`)) &&
    native.packageSha256 === proof.packageSha256 &&
    report.championStatePackageSha256 === proof.packageSha256 &&
    meta.decoderImageSha256 === sha(image) &&
    meta.build === report.build &&
    meta.protocol === report.protocol &&
    proof.nativeEvidenceSha256 === sha(await read(nativePath)) &&
    native.preparerSha256 ===
      sha(await read(`${root}/tools/prepare-champion-state.py`)) &&
    proof.inspectorSha256 ===
      sha(await read(`${root}/tools/inspect-champion-state.mjs`)) &&
    visual.rendererSha256 ===
      sha(await read(`${root}/tools/render-champion-state.mjs`)) &&
    visual.comparisonSha256 === sha(await read(proofPath)) &&
    visual.imageSha256 ===
      sha(await read(`${assets}/evidence/latest-champion-state.png`)) &&
    visual.svgSha256 ===
      sha(await read(`${assets}/evidence/latest-champion-state.svg`)) &&
    JSON.stringify(visual.counts) === JSON.stringify(c) &&
    c.groupChecks === native.counts.nativeGroups &&
    c.consumerChecks === native.counts.consumerChecks &&
    c.byteChecks === native.counts.nativeBytes &&
    c.wireProbeChecks === native.counts.wireProbes &&
    c.rejectionChecks === 4 &&
    c.updates === report.championStateUpdates.length &&
    c.updates === 2096 &&
    c.registeredFields === 137 &&
    c.snapshotChecks === 7440 &&
    c.reverseSeekChecks === 744 &&
    c.deathChecks === 8 &&
    c.respawnChecks === 8 &&
    c.nameChecks === 10 &&
    c.legacyChecks === 34 &&
    proof.scope.mainViewerSourceIntegrated &&
    proof.scope.nativeSchemaExecuted &&
    proof.scope.fullChampionGroupsParsed &&
    !proof.scope.browserRun &&
    !proof.scope.leagueAvCompared &&
    !proof.scope.layoutReferenceVerified &&
    !proof.scope.shieldSemanticsVerified,
  "Champion state evidence incomplete or stale",
);
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await read(`${root}/tools/${name}`)) === h,
    `Native source changed: ${name}`,
  );
for (const [name, h] of Object.entries(proof.sources))
  check(
    sha(await read(`${root}/${name}`)) === h,
    `Champion source changed: ${name}`,
  );
for (const record of [native, proof])
  for (const [p, h] of Object.entries(record.inputs))
    check(sha(await read(p)) === h, `Champion input changed: ${p}`);
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Native champion instruction changed",
  );
const counts = Object.fromEntries(
  Object.keys(c.fieldObservations).map((k) => [k, 0]),
);
for (const u of report.championStateUpdates)
  for (const k of Object.keys(counts)) if (Object.hasOwn(u, k)) counts[k]++;
check(
  JSON.stringify(counts) === JSON.stringify(c.fieldObservations),
  "State field counts differ",
);
check(
  Object.values(meta.groups).reduce((n, g) => n + g.count, 0) === 137 &&
    Object.values(meta.groups).filter((g) => g.count > 0).length === 6,
  "Native schema coverage differs",
);
const build = await Bun.build({
  entrypoints: [
    `${root}/latest-viewer.mjs`,
    `${root}/structural-check-worker.mjs`,
  ],
  target: "browser",
  external: ["three", "/assets/*"],
});
check(
  build.success && build.outputs.length === 2,
  "Champion viewer/worker browser-target build failed",
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
for (const name of ["latest-champion-state", "latest-replication"])
  paths.set(`/assets/${name}/package.json`, `${assets}/${name}/package.json`);
for (const name of [
  "latest-champion-state.png",
  "latest-champion-state.svg",
  "latest-champion-state.json",
])
  paths.set(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
for (const name of [
  "champion-state-native.json",
  "champion-state-comparison.json",
  "latest-semantics-champion-state.json",
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
        check(
          response.status === 200 &&
            sha(await response.arrayBuffer()) === item.sha256,
          `Champion HTTP delivery differs: ${origin}${item.path}`,
        );
        checks.push({ url: `${origin}${item.path}`, sha256: item.sha256 });
      }
    }),
  );
  for (const r of results) if (r.status === "rejected") throw r.reason;
}
checks.sort((a, b) => a.url.localeCompare(b.url));
await Bun.write(
  `${cache}/research/champion-state-publication.json`,
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
