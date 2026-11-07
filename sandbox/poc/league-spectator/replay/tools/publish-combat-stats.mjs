import { resolve, dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { COMBAT_STATS_SHA } from "../latest-combat-stats.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: publish-combat-stats.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  nativePath = `${cache}/research/combat-stats-native.json`,
  native = await json(nativePath),
  comparisonPath = `${cache}/research/combat-stats-comparison.json`,
  proof = await json(comparisonPath),
  visual = await json(`${assets}/evidence/latest-combat-stats.json`),
  report = await json(`${cache}/research/latest-semantics-combat-stats.json`),
  catalog = await json(`${assets}/latest-items/package.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  meta = await json(`${assets}/latest-combat-stats/package.json`),
  c = proof.counts;
check(
  native.packageSha256 === COMBAT_STATS_SHA &&
    proof.packageSha256 === COMBAT_STATS_SHA &&
    report.combatStatPackageSha256 === COMBAT_STATS_SHA &&
    sha(await raw(`${assets}/latest-combat-stats/package.json`)) ===
      COMBAT_STATS_SHA &&
    meta.decoderImageSha256 === sha(image),
  "Combat package differs",
);
check(
  native.preparerSha256 ===
    sha(await raw(`${root}/tools/prepare-combat-stats.py`)) &&
    proof.nativeEvidenceSha256 === sha(await raw(nativePath)) &&
    proof.inspectorSha256 ===
      sha(await raw(`${root}/tools/inspect-combat-stats.mjs`)) &&
    visual.comparisonSha256 === sha(await raw(comparisonPath)) &&
    visual.rendererSha256 ===
      sha(await raw(`${root}/tools/render-combat-stats.mjs`)) &&
    visual.imageSha256 ===
      sha(await raw(`${assets}/evidence/latest-combat-stats.png`)) &&
    visual.svgSha256 ===
      sha(await raw(`${assets}/evidence/latest-combat-stats.svg`)) &&
    isDeepStrictEqual(c, visual.counts),
  "Combat proof/visual stale",
);
for (const record of [native, proof, visual])
  for (const [p, h] of Object.entries(record.inputs))
    check(sha(await raw(p)) === h, `Combat input changed: ${p}`);
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    "Native stat helper changed",
  );
for (const [name, h] of Object.entries(proof.sources))
  check(
    sha(await raw(`${root}/${name}`)) === h,
    "Stat integration source changed",
  );
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original stat instruction changed",
  );
check(
  c.stats === 24 &&
    c.inputFields === 31 &&
    c.probes === 96 &&
    c.probeScalarChecks === 2304 &&
    c.records === 3812 &&
    c.groupChecks === 5930 &&
    c.byteChecks === 42370 &&
    c.inputChecks === 1184 &&
    c.scalarChecks === 91488 &&
    c.updates === 419 &&
    report.combatStatUpdates.length === 419 &&
    c.legacyChecks === 47 &&
    c.snapshotChecks === 4520 &&
    c.reverseSeekChecks === 4520 &&
    c.canvasChecks === 4520 &&
    c.worldChecks === 48 &&
    c.deathChecks === 792 &&
    c.partialDependencyChecks === 2 &&
    c.formatChecks === 3 &&
    c.rejectionChecks === 11,
  "Combat coverage incomplete",
);
check(
  proof.scope.originalRegistrationExecuted &&
    proof.scope.nativeRawToCacheExecuted &&
    proof.scope.namedApiScalarPathsExecuted &&
    proof.scope.mainViewerSourceIntegrated &&
    proof.scope.canvasCommandsExecuted &&
    !proof.scope.completeApiObjectBuilt &&
    !proof.scope.optionalAttributeObserversExecuted &&
    !proof.scope.nativeFrameSchedulingVerified &&
    !proof.scope.attackSpeedDecoded &&
    !proof.scope.tenacityDecoded &&
    !proof.scope.browserRun &&
    !proof.scope.leagueAvCompared &&
    !proof.scope.wholeMatchVerified &&
    visual.scope.offscreenPanelRender &&
    !visual.scope.actualBrowserCapture,
  "Combat evidence scope changed",
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
  `Stat viewer/worker build failed: ${build.logs.join("\n")}`,
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
  "latest-combat-stats/package.json",
  "latest-corpse/package.json",
  "latest-inventory/package.json",
  "latest-items/package.json",
  "latest-experience/package.json",
  "latest-world-state/package.json",
  "latest-champion-state/package.json",
  "latest-replication/package.json",
  "latest-scene/manifest.json",
  "decoder-16.21-macos/profile.json",
  "decoder-16.21-macos/image.bin",
  "decoder-16.21-macos/constructors.bin",
  "evidence/latest-combat-stats.png",
  "evidence/latest-combat-stats.svg",
  "evidence/latest-combat-stats.json",
])
  paths.set(`/assets/${name}`, `${assets}/${name}`);
for (const id of proof.observedItemIds) {
  const a = catalog.items[id];
  paths.set(
    `/assets/latest-items/${a.icon}`,
    `${assets}/latest-items/${a.icon}`,
  );
}
for (const name of [
  "combat-stats-native.json",
  "combat-stats-comparison.json",
  "latest-semantics-combat-stats.json",
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
          r = await fetch(`${origin}${item.path}`, {
            signal: AbortSignal.timeout(30000),
          });
        check(
          r.status === 200 && sha(await r.arrayBuffer()) === item.sha256,
          `HTTP stat delivery differs: ${origin}${item.path}`,
        );
        checks.push({ url: `${origin}${item.path}`, sha256: item.sha256 });
      }
    }),
  );
  for (const r of results) if (r.status === "rejected") throw r.reason;
}
await Bun.write(
  `${cache}/research/combat-stats-publication.json`,
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
