// Publish checked replay-backed particle integration to the existing preview.
// Source integration, offscreen evidence and browser acceptance stay separate.
import { resolve, dirname } from "node:path";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: publish-replay-particles.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`;
const sha = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
const read = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer());
const json = async (path) =>
  JSON.parse(new TextDecoder().decode(await read(path)));
const requireThat = (condition, message) => {
  if (!condition) throw Error(message);
};
const playbackPath = `${cache}/research/bound-vfx-playback.json`,
  nativePath = `${cache}/research/bound-vfx-playback-native.json`,
  gpuPath = `${cache}/research/replay-particle-gpu.json`;
const playback = await json(playbackPath),
  native = await json(nativePath),
  gpu = await json(gpuPath),
  prepared = await json(`${assets}/latest-replay-particles/package.json`),
  visual = await json(`${assets}/evidence/latest-replay-particles.json`);
for (const [record, relative] of [
  [playback, "tools/inspect-bound-vfx-playback.mjs"],
  [gpu, "tools/inspect-replay-particle-gpu.mjs"],
])
  requireThat(
    record.inspectorSha256 === sha(await read(`${root}/${relative}`)),
    `Stale inspector: ${relative}`,
  );
requireThat(
  native.observerSha256 ===
    sha(await read(`${root}/tools/observe-bound-vfx-playback.py`)) &&
    native.playbackSha256 === sha(await read(playbackPath)) &&
    native.counts.samples === playback.samples.length &&
    native.counts.mismatches === 0 &&
    native.mismatches.length === 0 &&
    native.observations.length === playback.samples.length &&
    playback.counts.seekChecks === playback.counts.snapshots &&
    prepared.preparerSha256 ===
      sha(await read(`${root}/tools/prepare-replay-particles.mjs`)) &&
    gpu.gpuPackageSha256 ===
      sha(await read(`${assets}/latest-replay-particles/package.json`)) &&
    visual.rendererSha256 ===
      sha(await read(`${root}/tools/render-replay-particles.py`)) &&
    visual.drawAdapterSha256 ===
      sha(await read(`${root}/tools/render-particle-shader.py`)) &&
    visual.imageSha256 ===
      sha(await read(`${assets}/evidence/latest-replay-particles.png`)) &&
    visual.samples.length === 6 &&
    visual.samples.some((sample) => sample.visiblePixels >= 30) &&
    visual.scope.mainViewerSourceIntegrated &&
    !visual.scope.browserRun &&
    !visual.scope.threeGpuSubmissionObserved &&
    !visual.scope.leagueReferenceCompared,
  "Replay particle evidence is incomplete or stale",
);
for (const record of [gpu, visual, prepared])
  for (const [path, expected] of Object.entries(record.sources))
    requireThat(
      sha(await read(path)) === expected,
      `Stale render source: ${path}`,
    );
for (const [name, expected] of Object.entries(playback.sources))
  requireThat(
    sha(await read(`${root}/${name}`)) === expected,
    `Stale composition source: ${name}`,
  );
for (const [path, expected] of Object.entries(playback.inputs))
  requireThat(
    sha(await read(path)) === expected,
    `Stale composition input: ${path}`,
  );
for (const [index, sample] of playback.samples.entries()) {
  const observed = native.observations[index];
  requireThat(
    observed.sample === index &&
      ["vectors", "rngHex", "actorHex", "poolHex"].every(
        (key) =>
          JSON.stringify(observed.state[key]) ===
          JSON.stringify(sample.state[key]),
      ),
    "Native/composed persistent state disagrees",
  );
  if (sample.geometry)
    requireThat(
      ["verticesHex", "indicesHex", "drawHex"].every(
        (key) => observed.geometry[key] === sample.geometry[key],
      ),
      "Native/composed geometry disagrees",
    );
}
const viewer = await Bun.file(`${root}/latest-viewer.mjs`).text(),
  renderer = await Bun.file(`${root}/latest-vfx-bound-renderer.mjs`).text(),
  html = await Bun.file(`${root}/latest.html`).text();
const pinnedGpuPackage = renderer.match(
  /const PACKAGE_SHA =\s*"([a-f0-9]{64})"/,
)?.[1];
requireThat(
  viewer.includes(
    'import { LatestBoundVfxRenderer } from "./latest-vfx-bound-renderer.mjs"',
  ) &&
    viewer.includes("vfxRenderer?.update(time, camera)") &&
    pinnedGpuPackage === gpu.gpuPackageSha256,
  "Main viewer or pinned replay GPU package is not connected",
);
const ids = [
  ...new Set([...viewer.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1])),
];
requireThat(
  ids.every((id) => html.includes(`id="${id}"`)),
  "Viewer references an absent DOM element",
);
const build = await Bun.build({
  entrypoints: [`${root}/latest-viewer.mjs`],
  target: "browser",
  external: ["three"],
  plugins: [
    {
      name: "assets",
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
  "Integrated replay viewer failed browser-target build",
);
const paths = new Map();
const add = (url, file) => paths.set(url, file);
const expose = async (name, file) => {
  await Bun.write(`${assets}/evidence/${name}`, await read(file));
  add(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
};
await expose("bound-vfx-playback.json", playbackPath);
await expose("bound-vfx-playback-native.json", nativePath);
await expose("replay-particle-gpu.json", gpuPath);
for (const path of [
  "latest-replay-particles.png",
  "latest-replay-particles.json",
])
  add(`/assets/evidence/${path}`, `${assets}/evidence/${path}`);
add(
  "/assets/latest-replay-particles/package.json",
  `${assets}/latest-replay-particles/package.json`,
);
for (const file of [
  "profile.json",
  "image.bin",
  "vfx-spawn.json",
  "vfx-emitter.json",
  "vfx-postload.json",
  "vfx-bound-quads.json",
  "vfx-samplers.json",
])
  add(
    `/assets/decoder-16.21-macos/${file}`,
    `${assets}/decoder-16.21-macos/${file}`,
  );
const bound = await json(`${assets}/decoder-16.21-macos/vfx-bound-quads.json`);
for (const ref of [
  bound.templates[0],
  ...bound.templates.filter((t) =>
    prepared.emitters.some((e) => e.graphSha256 === t.sha256),
  ),
])
  add(
    `/assets/decoder-16.21-macos/${ref.file}`,
    `${assets}/decoder-16.21-macos/${ref.file}`,
  );
for (const emitter of prepared.emitters) {
  for (const shader of Object.values(emitter.shaders))
    add(
      `/assets/latest-shaders/${shader.file}`,
      `${assets}/latest-shaders/${shader.file}`,
    );
  for (const texture of Object.values(emitter.textures))
    if (texture.kind === "prepared-texture")
      add(
        `/assets/latest-effects/${texture.file}`,
        `${assets}/latest-effects/${texture.file}`,
      );
}
for (const name of [
  "three.module.js",
  "three.core.js",
  "unicorn_x86_candidate.mjs",
  "GLTFLoader.js",
  "OrbitControls.js",
])
  add(`/assets/vendor/${name}`, `${assets}/vendor/${name}`);
const visited = new Set();
async function includeModule(file) {
  if (visited.has(file)) return;
  visited.add(file);
  add(`/${file.slice(root.length + 1).replaceAll("\\", "/")}`, file);
  const source = await Bun.file(file).text();
  for (const match of source.matchAll(
    /(?:from\s*|import\s*\()\s*["'](\.\.?\/[^"']+\.mjs)["']/g,
  ))
    await includeModule(resolve(dirname(file), match[1]));
}
await includeModule(resolve(root, "latest-viewer.mjs"));
for (const file of ["latest.html", "README.md", "AV-FIDELITY-MAP.md"])
  add(`/${file}`, `${root}/${file}`);
const results = [];
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  for (const [path, file] of paths) {
    const response = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.arrayBuffer(),
      expected = sha(await read(file));
    requireThat(
      response.status === 200 && sha(data) === expected,
      `Replay particle publication differs: ${base}${path}`,
    );
    results.push({ base, path, status: response.status, sha256: expected });
  }
}
const proof = {
  schema: 1,
  kind: "replay-particle-integration-publication",
  build: prepared.build,
  publisherSha256: sha(await read(import.meta.path)),
  viewerSha256: sha(await read(`${root}/latest-viewer.mjs`)),
  rendererSha256: sha(await read(`${root}/latest-vfx-bound-renderer.mjs`)),
  gpuPackageSha256: gpu.gpuPackageSha256,
  imageSha256: visual.imageSha256,
  compositionCounts: playback.counts,
  nativeCounts: native.counts,
  gpuCounts: gpu.counts,
  visualCounts: visual.counts,
  browserBuildSha256: sha(await build.outputs[0].arrayBuffer()),
  domBindings: ids.length,
  results,
  scope: {
    mainViewerSourceIntegrated: true,
    browserTargetBuild: true,
    offscreenRenderObserved: true,
    visualInspectionAutomated: false,
    browserRun: false,
    threeGpuSubmissionObserved: false,
    leagueReferenceCompared: false,
    productionDeployment: false,
  },
};
await Bun.write(
  `${cache}/research/replay-particle-publication.json`,
  JSON.stringify(proof, null, 2),
);
console.log(
  JSON.stringify({
    matchedFiles: results.length,
    nativeCounts: native.counts,
    gpuCounts: gpu.counts,
    domBindings: ids.length,
  }),
);
