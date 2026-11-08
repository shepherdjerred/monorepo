// Publish the broad request pipeline and its explicit capability diagnostic.
import { resolve } from "node:path";
import { loadNativeParticleColorBindings } from "./particle-color-bindings.mjs";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: publish-effect-pipeline.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  path = `${cache}/research/effect-pipeline-comparison.json`,
  proof = await read(path),
  gpu = await read(`${assets}/latest-complete-quad-gpu/package.json`),
  programs = await read(`${cache}/research/complete-quad-gpu-observation.json`),
  visual = await read(`${assets}/evidence/latest-effect-pipeline.json`),
  colors = await loadNativeParticleColorBindings({ assets, raw, sha }),
  colorProof = await read(
    `${cache}/research/particle-color-gpu-comparison.json`,
  ),
  colorVisual = await read(`${assets}/evidence/latest-particle-color.json`);
check(
  colors.size === 551 &&
    colorProof.counts.priorBindingsPreserved === 1504 &&
    colorProof.counts.newBindings === 404 &&
    colorProof.counts.colorTextureBindings === 404 &&
    colorProof.counts.rejections === 3 &&
    !colorProof.scope.nativeFactoryExecuted,
  "Incomplete shared particle color evidence",
);
for (const [path, h] of Object.entries(colorProof.inputs))
  check(sha(await raw(path)) === h, `Particle color input changed: ${path}`);
for (const [name, h] of Object.entries(colorProof.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    `Particle color source changed: ${name}`,
  );
for (const [path, h] of Object.entries(colorVisual.sources))
  check(
    sha(await raw(path)) === h,
    `Particle color visual input changed: ${path}`,
  );
check(
  colorVisual.rendererSha256 ===
    sha(await raw(`${root}/tools/render-particle-color.py`)) &&
    colorVisual.adapterSha256 ===
      sha(await raw(`${root}/tools/render-particle-shader.py`)) &&
    colorVisual.imageSha256 ===
      sha(await raw(`${assets}/evidence/latest-particle-color.png`)) &&
    colorVisual.samples.length === 9 &&
    colorVisual.samples.filter((s) => s.lookupChangedPixels > 0).length === 8 &&
    colorVisual.scope.authoredColorTextures &&
    !colorVisual.scope.nativeFactoryExecuted,
  "Particle color visual evidence changed",
);
check(
  proof.counts.events === 5979 &&
    proof.counts.descriptorFieldChecks === 91184 &&
    proof.counts.snapshotChecks === 6864 &&
    proof.counts.controlledChecks === 6 &&
    proof.counts.rejectionChecks === 7 &&
    proof.summary.creationRequests === 2224 &&
    proof.summary.removalRequests === 3755 &&
    proof.scope.requestLifecycleOnly &&
    !proof.scope.nativeFactorySucceededInferred &&
    !proof.scope.removalIsImmediateDeletion,
  "Incomplete effect request pipeline evidence",
);
for (const [name, h] of Object.entries(proof.sources))
  check(
    sha(await raw(`${root}/${name}`)) === h,
    `Effect pipeline source changed: ${name}`,
  );
for (const [name, h] of Object.entries(proof.inputs))
  check(sha(await raw(name)) === h, `Effect pipeline input changed: ${name}`);
for (const [name, h] of Object.entries(gpu.inputs))
  check(sha(await raw(name)) === h, `Effect GPU input changed: ${name}`);
check(
  programs.packageSha256 ===
    sha(await raw(`${assets}/latest-complete-quad-gpu/package.json`)) &&
    programs.counts.emitterBindings === 1782 &&
    programs.counts.uniquePrograms === 7 &&
    programs.counts.compileFailures === 0 &&
    programs.counts.linkFailures === 0 &&
    programs.observerSha256 ===
      sha(await raw(`${root}/tools/observe-complete-quad-gpu.py`)) &&
    programs.adapterSha256 ===
      sha(await raw(`${root}/tools/render-particle-shader.py`)),
  "Complete quad GPU observation changed",
);
check(
  visual.comparisonSha256 === sha(await raw(path)) &&
    visual.rendererSha256 ===
      sha(await raw(`${root}/tools/render-effect-pipeline.py`)) &&
    visual.imageSha256 ===
      sha(await raw(`${assets}/evidence/latest-effect-pipeline.png`)),
  "Effect pipeline visual changed",
);
const build = await Bun.build({
  entrypoints: [
    `${root}/latest-viewer.mjs`,
    `${root}/structural-check-worker.mjs`,
  ],
  target: "browser",
  write: false,
  external: ["three", "three/*", "/assets/*"],
});
check(build.success, "Effect pipeline browser build failed");
const html = new TextDecoder().decode(await raw(`${root}/latest.html`)),
  viewer = new TextDecoder().decode(await raw(`${root}/latest-viewer.mjs`));
for (const match of viewer.matchAll(/\$\("([^"]+)"\)/g))
  check(
    html.includes(`id="${match[1]}"`),
    `Replay DOM reference absent: ${match[1]}`,
  );
const files = new Map(),
  add = async (url, path) =>
    files.set(url, { path, sha256: sha(await raw(path)) });
for (const name of [
  "latest.html",
  "latest-viewer.mjs",
  "latest-reconstruction.mjs",
  "structural-check-worker.mjs",
  "latest-effect-pipeline.mjs",
  "latest-effect-descriptor.mjs",
  "latest-effect-placement.mjs",
  "latest-effect-creation.mjs",
  "latest-effect-removal.mjs",
  "latest-particle-playback.mjs",
  "latest-trail-playback.mjs",
  "latest-trail-renderer.mjs",
])
  await add(`/${name}`, `${root}/${name}`);
for (const name of [
  "latest-effect-descriptor",
  "latest-effect-placement",
  "latest-effect-creation",
  "latest-effect-removal",
  "latest-complete-quad-gpu",
  "latest-particle-color",
])
  await add(`/assets/${name}/package.json`, `${assets}/${name}/package.json`);
await add(
  "/assets/latest-trail-particles/gpu.json",
  `${assets}/latest-trail-particles/gpu.json`,
);
for (const name of [
  "effect-pipeline-comparison",
  "complete-quad-gpu-observation",
  "particle-color-gpu-comparison",
]) {
  const output = `${assets}/evidence/latest-${name}.json`;
  await Bun.write(output, await raw(`${cache}/research/${name}.json`));
  await add(`/assets/evidence/latest-${name}.json`, output);
}
for (const extension of ["png", "json"])
  await add(
    `/assets/evidence/latest-effect-pipeline.${extension}`,
    `${assets}/evidence/latest-effect-pipeline.${extension}`,
  );
for (const extension of ["png", "json"])
  await add(
    `/assets/evidence/latest-particle-color.${extension}`,
    `${assets}/evidence/latest-particle-color.${extension}`,
  );
for (const entry of colors.values())
  await add(
    `/assets/latest-effects/${entry.asset.file}`,
    `${assets}/latest-effects/${entry.asset.file}`,
  );
let httpChecks = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
])
  for (const [url, f] of files) {
    const response = await fetch(base + url, {
      signal: AbortSignal.timeout(30000),
    });
    check(
      response.status === 200 &&
        sha(new Uint8Array(await response.arrayBuffer())) === f.sha256,
      `Effect pipeline HTTP differs: ${base + url}`,
    );
    httpChecks++;
  }
const publication = {
  schema: 1,
  kind: "effect-pipeline-preview-publication",
  httpChecks,
  publisherSha256: sha(await raw(import.meta.path)),
  comparisonSha256: sha(await raw(path)),
  files: Object.fromEntries(files),
  scope: {
    browserBuildPassed: true,
    sourceAndAssetHttpChecked: true,
    browserRun: false,
    requestLifecycleOnly: true,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/effect-pipeline-publication.json`,
  JSON.stringify(publication, null, 2),
);
console.log(
  JSON.stringify({
    httpChecks,
    files: files.size,
    visual:
      "https://desktop.tailnet-1a49.ts.net/assets/evidence/latest-effect-pipeline.png",
  }),
);
