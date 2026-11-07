import { resolve, dirname } from "node:path";
import { EXPERIENCE_SHA } from "../latest-experience.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: publish-experience.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  };
const nativePath = `${cache}/research/experience-native.json`,
  native = await json(nativePath),
  comparisonPath = `${cache}/research/experience-comparison.json`,
  proof = await json(comparisonPath),
  visual = await json(`${assets}/evidence/latest-experience.json`),
  report = await json(`${cache}/research/latest-semantics-experience.json`),
  champion = await json(`${cache}/research/champion-state-comparison.json`),
  world = await json(`${cache}/research/world-state-comparison.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  meta = await json(`${assets}/latest-experience/package.json`),
  c = proof.counts;
check(
  sha(await raw(`${assets}/latest-experience/package.json`)) ===
    EXPERIENCE_SHA &&
    native.packageSha256 === EXPERIENCE_SHA &&
    proof.packageSha256 === EXPERIENCE_SHA &&
    report.experiencePackageSha256 === EXPERIENCE_SHA &&
    meta.decoderImageSha256 === sha(image) &&
    native.preparerSha256 ===
      sha(await raw(`${root}/tools/prepare-experience.py`)) &&
    proof.nativeEvidenceSha256 === sha(await raw(nativePath)) &&
    proof.inspectorSha256 ===
      sha(await raw(`${root}/tools/inspect-experience.mjs`)) &&
    visual.comparisonSha256 === sha(await raw(comparisonPath)) &&
    visual.rendererSha256 ===
      sha(await raw(`${root}/tools/render-experience.mjs`)) &&
    visual.imageSha256 ===
      sha(await raw(`${assets}/evidence/latest-experience.png`)) &&
    visual.svgSha256 ===
      sha(await raw(`${assets}/evidence/latest-experience.svg`)) &&
    JSON.stringify(c) === JSON.stringify(visual.counts),
  "XP/inspection evidence is stale",
);
for (const record of [native, proof, champion, world]) {
  for (const [p, h] of Object.entries(record.inputs))
    check(sha(await raw(p)) === h, `Evidence input changed: ${p}`);
  for (const [name, h] of Object.entries(record.sources))
    check(
      sha(await raw(`${root}/${record === native ? "tools/" : ""}${name}`)) ===
        h,
      `Evidence source changed: ${name}`,
    );
}
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original XP instruction changed",
  );
check(
  c.getterChecks === native.counts.getterChecks &&
    c.getterChecks === 2493 &&
    c.byteChecks === native.counts.nativeBytes &&
    c.byteChecks === 17505 &&
    c.updates === report.experienceUpdates.length &&
    c.snapshotChecks === 4550 &&
    c.reverseSeekChecks === 4550 &&
    c.selectionChecks === 11 &&
    c.worldSelectionChecks === 48 &&
    c.deathChecks === 8 &&
    c.canvasChecks === 30 &&
    c.pickingChecks === 5 &&
    c.legacyChecks === 41 &&
    c.rejectionChecks === 6 &&
    champion.counts.groupChecks === 5930 &&
    champion.counts.wireProbeChecks === 294 &&
    world.counts.groupChecks === 844 &&
    world.counts.snapshotChecks === 16464 &&
    proof.scope.mainViewerSourceIntegrated &&
    proof.scope.threeRaycastExecuted &&
    !proof.scope.browserRun &&
    !proof.scope.leagueAvCompared &&
    !proof.scope.inventoryDecoded &&
    !proof.scope.experienceCurveSelectionVerified,
  "XP/inspection coverage incomplete",
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
  `Viewer/worker build failed: ${build.logs.join("\n")}`,
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
  "latest-experience/package.json",
  "latest-world-state/package.json",
  "latest-champion-state/package.json",
  "latest-replication/package.json",
  "latest-scene/manifest.json",
  "latest-scene/world.json",
  "decoder-16.21-macos/profile.json",
  "decoder-16.21-macos/image.bin",
  "decoder-16.21-macos/constructors.bin",
  "evidence/latest-experience.png",
  "evidence/latest-experience.svg",
  "evidence/latest-experience.json",
])
  paths.set(`/assets/${name}`, `${assets}/${name}`);
for (const name of [
  "experience-native.json",
  "experience-comparison.json",
  "latest-semantics-experience.json",
  "champion-state-comparison.json",
  "world-state-comparison.json",
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
          `HTTP delivery differs: ${origin}${item.path}`,
        );
        checks.push({ url: `${origin}${item.path}`, sha256: item.sha256 });
      }
    }),
  );
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
}
await Bun.write(
  `${cache}/research/experience-publication.json`,
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
