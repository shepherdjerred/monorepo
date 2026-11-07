// Publish component evidence and check the actual preview source bytes over HTTP.
import { resolve } from "node:path";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: publish-quad-pool-playback.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  requireValue = (v, m) => {
    if (!v) throw Error(m);
  },
  files = new Map(),
  records = {};
for (const [name, path] of Object.entries({
  playback: `${cache}/research/quad-pool-playback.json`,
  native: `${cache}/research/quad-pool-playback-native.json`,
  renderer: `${cache}/research/quad-pool-renderer-comparison.json`,
  visual: `${assets}/evidence/latest-quad-pool-playback.json`,
})) {
  const bytes = await raw(path);
  records[name] = { bytes, data: JSON.parse(new TextDecoder().decode(bytes)) };
}
const { playback, native, renderer, visual } = Object.fromEntries(
  Object.entries(records).map(([k, v]) => [k, v.data]),
);
requireValue(
  playback.build === "16.21.829.8620" &&
    playback.protocol === "20e09df23c66b85e" &&
    native.playbackSha256 === sha(records.playback.bytes) &&
    native.mismatches === 0 &&
    native.counts.samples === playback.counts.samples &&
    renderer.counts.frames > 0 &&
    renderer.scope.actualThreeAttributeAdapter &&
    renderer.scope.nativePackedBitsUnchanged &&
    renderer.scope.browserBundleBuilt &&
    renderer.scope.mainViewerSourceIntegrated &&
    !renderer.scope.browserRun &&
    !renderer.scope.threeGpuSubmissionObserved &&
    !visual.scope.browserRendered &&
    visual.scope.offscreenRendered &&
    renderer.inputs[`${cache}/research/quad-pool-playback.json`] ===
      sha(records.playback.bytes) &&
    renderer.inputs[`${cache}/research/quad-pool-playback-native.json`] ===
      sha(records.native.bytes),
  "Incomplete native quad pool component evidence",
);
for (const record of [playback, renderer])
  for (const [name, expected] of Object.entries(record.sources))
    requireValue(
      sha(await raw(`${root}/${name}`)) === expected,
      `Quad pool source changed: ${name}`,
    );
for (const record of [playback, renderer])
  for (const [path, expected] of Object.entries(record.inputs))
    requireValue(
      sha(await raw(path)) === expected,
      `Quad pool input changed: ${path}`,
    );
for (const [path, expected] of Object.entries(visual.sources))
  requireValue(
    sha(await raw(path)) === expected,
    `Quad pool visual input changed: ${path}`,
  );
for (const [name, expected] of Object.entries(native.sources))
  requireValue(
    sha(await raw(`${import.meta.dir}/${name}`)) === expected,
    `Quad pool native producer changed: ${name}`,
  );
requireValue(
  sha(await raw(`${import.meta.dir}/render-trail-playback.py`)) ===
    visual.rendererSha256,
  "Quad pool visual renderer changed",
);
const image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
for (const block of native.originalBlocks)
  requireValue(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Quad pool original code changed",
  );
requireValue(
  sha(await raw(`${assets}/evidence/latest-quad-pool-playback.png`)) ===
    visual.imageSha256,
  "Quad pool visual image changed",
);
for (const name of ["playback", "native", "renderer"]) {
  const path = `${assets}/evidence/latest-quad-pool-${name}-evidence.json`;
  await Bun.write(path, records[name].bytes);
  files.set(`/assets/evidence/latest-quad-pool-${name}-evidence.json`, {
    path,
    sha256: sha(records[name].bytes),
  });
}
for (const name of [
  "latest-quad-pool-playback.png",
  "latest-quad-pool-playback.json",
]) {
  const path = `${assets}/evidence/${name}`;
  files.set(`/assets/evidence/${name}`, { path, sha256: sha(await raw(path)) });
}
for (const name of [
  "latest.html",
  "latest-viewer.mjs",
  "latest-quad-pool-renderer.mjs",
  "latest-quad-pool-playback.mjs",
  "latest-trail-renderer.mjs",
  "latest-particle-playback.mjs",
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
    requireValue(
      response.status === 200 &&
        sha(new Uint8Array(await response.arrayBuffer())) === ref.sha256,
      `Quad pool preview bytes differ: ${base + url}`,
    );
    httpChecks++;
  }
await Bun.write(
  `${cache}/research/quad-pool-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "replay-quad-pool-preview-publication",
      httpChecks,
      files: Object.fromEntries(files),
      counts: playback.counts,
      scope: renderer.scope,
      publisherSha256: sha(await raw(import.meta.path)),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ httpChecks, files: files.size, counts: playback.counts }),
);
