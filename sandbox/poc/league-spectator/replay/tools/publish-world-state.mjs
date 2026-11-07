import { resolve, dirname } from "node:path";
import { WORLD_STATE_SHA } from "../latest-world-state.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: publish-world-state.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  };
const nativePath = `${cache}/research/world-state-native.json`,
  native = await json(nativePath),
  comparisonPath = `${cache}/research/world-state-comparison.json`,
  proof = await json(comparisonPath),
  championPath = `${cache}/research/champion-state-comparison.json`,
  champion = await json(championPath),
  visual = await json(`${assets}/evidence/latest-world-state.json`),
  report = await json(`${cache}/research/latest-semantics-world-state.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  meta = await json(`${assets}/latest-world-state/package.json`),
  c = proof.counts;
check(
  sha(await raw(`${assets}/latest-world-state/package.json`)) ===
    WORLD_STATE_SHA &&
    proof.packageSha256 === WORLD_STATE_SHA &&
    native.packageSha256 === WORLD_STATE_SHA &&
    report.worldStatePackageSha256 === WORLD_STATE_SHA &&
    meta.decoderImageSha256 === sha(image) &&
    proof.nativeEvidenceSha256 === sha(await raw(nativePath)) &&
    proof.inspectorSha256 ===
      sha(await raw(`${root}/tools/inspect-world-state.mjs`)) &&
    native.preparerSha256 ===
      sha(await raw(`${root}/tools/prepare-world-state.py`)) &&
    champion.inspectorSha256 ===
      sha(await raw(`${root}/tools/inspect-champion-state.mjs`)) &&
    visual.rendererSha256 ===
      sha(await raw(`${root}/tools/render-world-state.mjs`)) &&
    visual.comparisonSha256 === sha(await raw(comparisonPath)) &&
    visual.svgSha256 ===
      sha(await raw(`${assets}/evidence/latest-world-state.svg`)) &&
    visual.imageSha256 ===
      sha(await raw(`${assets}/evidence/latest-world-state.png`)) &&
    JSON.stringify(visual.counts) === JSON.stringify(c),
  "World state proof or visual is stale",
);
for (const record of [native, proof, champion]) {
  for (const [p, h] of Object.entries(record.inputs))
    check(sha(await raw(p)) === h, `Evidence input changed: ${p}`);
  for (const [p, h] of Object.entries(record.sources))
    check(
      sha(await raw(`${root}/${record === native ? "tools/" : ""}${p}`)) === h,
      `Evidence source changed: ${p}`,
    );
}
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original native instructions changed",
  );
check(
  c.entities === 48 &&
    c.minions === 38 &&
    c.towers === 10 &&
    c.entitiesWithHealth === 48 &&
    c.updates === report.worldStateUpdates.length &&
    c.updates === 545 &&
    c.groupChecks === native.counts.nativeGroups &&
    c.byteChecks === native.counts.nativeBytes &&
    c.consumerChecks === native.counts.consumerChecks &&
    c.snapshotChecks === 16464 &&
    c.reverseSeekChecks === 16464 &&
    c.creationChecks === 38 &&
    c.deathChecks === 23 &&
    c.heroRegressionChecks === 60 &&
    c.legacyChecks === 38 &&
    c.rejectionChecks === 6 &&
    champion.counts.groupChecks === 5930 &&
    champion.counts.wireProbeChecks === 294 &&
    proof.scope.mainViewerSourceIntegrated &&
    !proof.scope.browserRun &&
    !proof.scope.leagueAvCompared &&
    !proof.scope.minionTeamSemanticsVerified &&
    !proof.scope.arbitrarySrMatchesVerified,
  "World state coverage is incomplete",
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
  `Browser-target build failed: ${build.logs.join("\n")}`,
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
for (const name of [
  "latest-world-state/package.json",
  "latest-champion-state/package.json",
  "latest-replication/package.json",
  "latest-scene/manifest.json",
  "latest-scene/world.json",
  "decoder-16.21-macos/profile.json",
  "decoder-16.21-macos/image.bin",
  "decoder-16.21-macos/constructors.bin",
])
  paths.set(`/assets/${name}`, `${assets}/${name}`);
for (const a of Object.values(meta.assets))
  paths.set(
    `/assets/latest-scene/${a.catalogPath}`,
    `${assets}/latest-scene/${a.catalogPath}`,
  );
for (const name of [
  "latest-world-state.png",
  "latest-world-state.svg",
  "latest-world-state.json",
])
  paths.set(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
for (const name of [
  "world-state-native.json",
  "world-state-comparison.json",
  "latest-semantics-world-state.json",
  "champion-state-comparison.json",
]) {
  const dest = `${assets}/evidence/${name}`;
  await Bun.write(dest, await raw(`${cache}/research/${name}`));
  paths.set(`/assets/evidence/${name}`, dest);
}
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
          response = await fetch(`${origin}${item.path}`, {
            signal: AbortSignal.timeout(30000),
          });
        check(
          response.status === 200 &&
            sha(await response.arrayBuffer()) === item.sha256,
          `HTTP bytes differ: ${origin}${item.path}`,
        );
        checks.push({ url: `${origin}${item.path}`, sha256: item.sha256 });
      }
    }),
  );
  for (const r of results) if (r.status === "rejected") throw r.reason;
}
await Bun.write(
  `${cache}/research/world-state-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      publisherSha256: sha(await raw(import.meta.path)),
      comparisonSha256: sha(await raw(comparisonPath)),
      imageSha256: visual.imageSha256,
      counts: c,
      scope: proof.scope,
      checks: checks.sort((a, b) => a.url.localeCompare(b.url)),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ matchedFiles: checks.length, counts: c }));
