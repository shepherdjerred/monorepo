// Publish only hash-matched trail evidence and verify exact preview HTTP bytes.
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { TRAIL_PARTICLES_SHA } from "../latest-trail-particles.mjs";
// Keep publication independent of THREE; the renderer source is checked by its
// adapter evidence below and pins this same immutable GPU package.
const TRAIL_GPU_SHA =
  "b4dee053c3721792cb019c6433e53c303abd036effa2f783db80deeb8aeb156a";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: publish-trail-particles.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  meta = await read(`${assets}/latest-trail-particles/package.json`),
  gpu = await read(`${assets}/latest-trail-particles/gpu.json`),
  comparison = await read(`${cache}/research/trail-particles-comparison.json`),
  playback = await read(`${cache}/research/trail-playback.json`),
  native = await read(`${cache}/research/trail-playback-native.json`),
  renderer = await read(`${cache}/research/trail-renderer-comparison.json`),
  visualBytes = await raw(`${assets}/evidence/latest-trail-playback.json`),
  visual = JSON.parse(new TextDecoder().decode(visualBytes));
check(
  sha(await raw(`${assets}/latest-trail-particles/package.json`)) ===
    TRAIL_PARTICLES_SHA &&
    sha(await raw(`${assets}/latest-trail-particles/gpu.json`)) ===
      TRAIL_GPU_SHA,
  "Trail package pin changed",
);
check(
  comparison.packageSha256 === TRAIL_PARTICLES_SHA &&
    comparison.counts.graphs === 146 &&
    comparison.counts.frames === 4864 &&
    comparison.counts.checkpointFrames === 3648 &&
    comparison.counts.resetFrames === 4864 &&
    comparison.counts.previewStateDifferences === 0 &&
    comparison.counts.previewGeometryByteDifferences === 0 &&
    comparison.counts.previewWriterMathDifferences === 1,
  "Incomplete trail state/geometry comparison",
);
check(
  native.playbackSha256 ===
    sha(await raw(`${cache}/research/trail-playback.json`)) &&
    native.mismatches === 0 &&
    native.counts.samples === 36 &&
    native.counts.frames === 1008 &&
    playback.counts.reverseSeekChecks === 36 &&
    renderer.counts.frames === 60 &&
    renderer.counts.attributeBytes === 31512 &&
    renderer.scope.browserBundleBuilt &&
    visual.imageSha256 ===
      sha(await raw(`${assets}/evidence/latest-trail-playback.png`)) &&
    visual.samples.length === 15 &&
    !visual.scope.browserRendered,
  "Incomplete trail replay/render comparison",
);
for (const record of [comparison, playback, renderer]) {
  for (const [path, h] of Object.entries(record.inputs))
    check(sha(await raw(path)) === h, `Trail input changed: ${path}`);
  for (const [name, h] of Object.entries(record.sources))
    check(
      sha(await raw(`${root}/${name}`)) === h,
      `Trail source changed: ${name}`,
    );
}
for (const [path, h] of Object.entries(gpu.inputs))
  check(sha(await raw(path)) === h, `Trail GPU input changed: ${path}`);
for (const [path, h] of Object.entries(visual.sources))
  check(sha(await raw(path)) === h, `Trail visual input changed: ${path}`);
check(
  visual.rendererSha256 ===
    sha(await raw(`${root}/tools/render-trail-playback.py`)),
  "Trail visual renderer changed",
);
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    `Native replay source changed: ${name}`,
  );
check(
  comparison.inspectorSha256 ===
    sha(await raw(`${root}/tools/inspect-trail-particles.mjs`)),
  "Trail inspector changed",
);
const files = new Map(),
  add = async (url, path) => {
    files.set(url, { path, sha256: sha(await raw(path)) });
  };
for (const name of [
  "latest.html",
  "latest-viewer.mjs",
  "latest-trail-particles.mjs",
  "latest-trail-playback.mjs",
  "latest-particle-playback.mjs",
  "latest-trail-renderer.mjs",
  "latest-vfx-control.mjs",
])
  await add(`/${name}`, `${root}/${name}`);
await add(
  "/assets/latest-trail-particles/package.json",
  `${assets}/latest-trail-particles/package.json`,
);
await add(
  "/assets/latest-trail-particles/gpu.json",
  `${assets}/latest-trail-particles/gpu.json`,
);
for (const t of meta.templates)
  await add(
    `/assets/latest-trail-particles/${t.file}`,
    `${assets}/latest-trail-particles/${t.file}`,
  );
for (const e of gpu.emitters) {
  for (const ref of Object.values(e.shaders))
    await add(
      `/assets/latest-shaders/${ref.file}`,
      `${assets}/latest-shaders/${ref.file}`,
    );
  for (const t of Object.values(e.textures))
    if (t.kind === "prepared-texture")
      await add(
        `/assets/latest-effects/${t.file}`,
        `${assets}/latest-effects/${t.file}`,
      );
}
for (const name of [
  "trail-particles-comparison",
  "trail-materials-native",
  "trail-playback",
  "trail-playback-native",
  "trail-renderer-comparison",
]) {
  const publishedName =
    name === "trail-playback" ? "trail-playback-observation" : name;
  const path = `${assets}/evidence/latest-${publishedName}.json`;
  await Bun.write(path, await raw(`${cache}/research/${name}.json`));
  await add(`/assets/evidence/latest-${publishedName}.json`, path);
}
const nativeBytes = await raw(`${cache}/research/trail-particles-native.json`),
  compressed = gzipSync(nativeBytes, { level: 9 }),
  compressedPath = `${assets}/evidence/latest-trail-particles-native.json.gz`;
check(
  sha(nativeBytes) === comparison.nativeSha256,
  "Trail native evidence hash changed",
);
await Bun.write(compressedPath, compressed);
await add(
  "/assets/evidence/latest-trail-particles-native.json.gz",
  compressedPath,
);
for (const extension of ["png", "json"])
  await add(
    `/assets/evidence/latest-trail-playback.${extension}`,
    `${assets}/evidence/latest-trail-playback.${extension}`,
  );
check(
  sha(await raw(`${assets}/evidence/latest-trail-playback.json`)) ===
    sha(visualBytes),
  "Trail publication overwrote its visual metadata",
);
let httpChecks = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  for (const [url, ref] of files) {
    const response = await fetch(base + url, {
      signal: AbortSignal.timeout(30000),
    });
    check(
      response.status === 200 &&
        sha(new Uint8Array(await response.arrayBuffer())) === ref.sha256,
      `Trail HTTP content differs: ${base + url}`,
    );
    httpChecks++;
  }
}
const result = {
  schema: 1,
  kind: "trail-preview-publication",
  publisherSha256: sha(await raw(import.meta.path)),
  packageSha256: TRAIL_PARTICLES_SHA,
  gpuSha256: TRAIL_GPU_SHA,
  httpChecks,
  nativeEvidenceSha256: sha(nativeBytes),
  compressedNativeEvidenceSha256: sha(compressed),
  compressedNativeBytes: compressed.length,
  files: Object.fromEntries(files),
  scope: {
    mainViewerSourceIntegrated: true,
    localAndTailscaleBytesVerified: true,
    nativeReplayCompared: true,
    offscreenShaderRendered: true,
    browserRun: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/trail-particles-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    httpChecks,
    files: files.size,
    compressedNativeBytes: compressed.length,
    visual:
      "https://desktop.tailnet-1a49.ts.net/assets/evidence/latest-trail-playback.png",
  }),
);
