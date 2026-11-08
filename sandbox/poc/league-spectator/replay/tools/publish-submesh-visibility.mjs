import { resolve, dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { SUBMESH_VISIBILITY_SHA } from "../latest-submesh-visibility.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: publish-submesh-visibility.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  nativePath = `${cache}/research/submesh-visibility-native.json`,
  native = await json(nativePath),
  proofPath = `${cache}/research/submesh-visibility-comparison.json`,
  proof = await json(proofPath),
  visual = await json(`${assets}/evidence/latest-submesh-visibility.json`),
  meta = await json(`${assets}/latest-submesh-visibility/package.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  c = proof.counts;
check(
  native.packageSha256 === SUBMESH_VISIBILITY_SHA &&
    proof.packageSha256 === SUBMESH_VISIBILITY_SHA &&
    sha(await raw(`${assets}/latest-submesh-visibility/package.json`)) ===
      SUBMESH_VISIBILITY_SHA &&
    meta.decoderImageSha256 === sha(image),
  "Submesh package differs",
);
check(
  native.preparerSha256 ===
    sha(await raw(`${root}/tools/prepare-submesh-visibility.py`)) &&
    proof.nativeEvidenceSha256 === sha(await raw(nativePath)) &&
    proof.inspectorSha256 ===
      sha(await raw(`${root}/tools/inspect-submesh-visibility.mjs`)) &&
    visual.comparisonSha256 === sha(await raw(proofPath)) &&
    visual.rendererSha256 ===
      sha(await raw(`${root}/tools/render-submesh-visibility.mjs`)) &&
    visual.imageSha256 ===
      sha(await raw(`${assets}/evidence/latest-submesh-visibility.png`)) &&
    visual.svgSha256 ===
      sha(await raw(`${assets}/evidence/latest-submesh-visibility.svg`)) &&
    isDeepStrictEqual(c, visual.counts),
  "Submesh evidence stale",
);
for (const record of [native, proof, visual])
  for (const [p, h] of Object.entries(record.inputs))
    check(sha(await raw(p)) === h, `Submesh input changed: ${p}`);
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    "Native submesh helper changed",
  );
for (const [name, h] of Object.entries(proof.sources))
  check(
    sha(await raw(`${root}/${name}`)) === h,
    "Submesh integration source changed",
  );
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original submesh instruction changed",
  );
check(
  c.assets === 18 &&
    c.ranges === 71 &&
    c.groups === 48 &&
    c.events === 123 &&
    c.sequences === 153 &&
    c.frames === 2258 &&
    c.nativeFrames === 2258 &&
    c.checkpointChecks === 2258 &&
    c.resetChecks === 2258 &&
    c.rangeChecks === 71 &&
    c.maskChecks === 4235 &&
    c.nodeChecks === 34740 &&
    c.deathChecks === 48 &&
    c.reverseSeekChecks === 48 &&
    c.respawnChecks === 8 &&
    c.postDeathUnresolved === 7 &&
    c.rejectionChecks === 13 &&
    c.deathGraphChecks === 48 &&
    c.unresolvedDeathGraphs === 2,
  "Submesh coverage incomplete",
);
check(
  proof.scope.nativeResourceMapConstructorExecuted &&
    proof.scope.nativeEventConstructorExecuted &&
    proof.scope.nativeSchedulerExecuted &&
    proof.scope.nativeMaskSettersExecuted &&
    proof.scope.translatedSchedulerCompared &&
    proof.scope.mainDeathPreviewSourceIntegrated &&
    proof.scope.threeNodeVisibilityExecuted &&
    proof.scope.boundaryClockSupplied &&
    proof.scope.initialSkinMaskSupplied &&
    !proof.scope.gameCallbacksReplaced &&
    !proof.scope.rawSknLoaderExecuted &&
    !proof.scope.fullAnimationGraphExecuted &&
    !proof.scope.nativeFrameCadenceVerified &&
    !proof.scope.graphicsSubmissionExecuted &&
    !proof.scope.leagueAvCompared &&
    !proof.scope.nativeAnimationClockVerified &&
    !proof.scope.fullGraphLifecycleVerified &&
    !proof.scope.avatarOnlyGraphicsCompositionVerified &&
    !proof.scope.championCorpseRetirementVerified &&
    !proof.scope.browserRun &&
    visual.scope.softwareMeshProjection &&
    !visual.scope.actualWebGlCapture &&
    !visual.scope.deathVfxRendered &&
    isDeepStrictEqual(visual.triangles, [25574, 2964, 0, 0]),
  "Submesh evidence scope changed",
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
  `Submesh browser-target build failed: ${build.logs.join("\n")}`,
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
  "latest-submesh-visibility/package.json",
  "latest-combat-stats/package.json",
  "latest-scene/manifest.json",
  "latest-scene/world.json",
  "decoder-16.21-macos/profile.json",
  "decoder-16.21-macos/image.bin",
  "evidence/latest-submesh-visibility.png",
  "evidence/latest-submesh-visibility.svg",
  "evidence/latest-submesh-visibility.json",
])
  paths.set(`/assets/${name}`, `${assets}/${name}`);
for (const entry of Object.values(meta.assets))
  for (const name of [entry.model, entry.skn])
    paths.set(`/assets/latest-scene/${name}`, `${assets}/latest-scene/${name}`);
for (const name of Object.keys(meta.assets))
  paths.set(`/assets/latest-scene/${name}`, `${assets}/latest-scene/${name}`);
for (const name of [
  "submesh-visibility-native.json",
  "submesh-visibility-comparison.json",
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
          `HTTP submesh delivery differs: ${origin}${item.path}`,
        );
        checks.push({ url: `${origin}${item.path}`, sha256: item.sha256 });
      }
    }),
  );
  for (const r of results) if (r.status === "rejected") throw r.reason;
}
await Bun.write(
  `${cache}/research/submesh-visibility-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      publisherSha256: sha(await raw(import.meta.path)),
      comparisonSha256: sha(await raw(proofPath)),
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
