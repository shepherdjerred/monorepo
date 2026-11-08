// Publish measured native graphics coverage without claiming browser playback.
import { resolve } from "node:path";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: publish-vfx-graphics.mjs <cache>");
const cache = resolve(arg),
  assets = `${cache}/public`,
  raw = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer()),
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  requireValue = (value, message) => {
    if (!value) throw Error(message);
  },
  observation = await raw(`${cache}/research/vfx-graphics-native.json`),
  native = JSON.parse(new TextDecoder().decode(observation)),
  inspection = await raw(`${cache}/research/vfx-graphics-inspection.json`),
  proof = JSON.parse(new TextDecoder().decode(inspection)),
  summary = await read(`${assets}/evidence/latest-vfx-graphics.json`),
  texturePackage = await read(`${assets}/latest-native-textures/package.json`);
requireValue(
  native.build === "16.21.829.8620" &&
    proof.observationSha256 === sha(observation) &&
    proof.mismatchCount === 0 &&
    proof.checks.completeRoots === 876 &&
    proof.checks.shaderSelections === 1224 &&
    proof.checks.linkedPrograms === 612 &&
    proof.checks.gpuSubresources === 28878 &&
    summary.observationSha256 === sha(observation) &&
    summary.inspectionSha256 === sha(inspection) &&
    !native.scope.mainViewerIntegrated &&
    !native.scope.renderedCoverageEstablished &&
    !native.scope.browserOrLeagueExecuted,
  "Incomplete or changed native graphics evidence",
);
for (const [path, expected] of Object.entries(native.inputs))
  requireValue(
    sha(await raw(path)) === expected,
    `Native graphics input changed: ${path}`,
  );
for (const [name, expected] of Object.entries(native.sources))
  requireValue(
    sha(await raw(resolve(import.meta.dir, name))) === expected,
    `Native graphics source changed: ${name}`,
  );
requireValue(
  sha(await raw(resolve(import.meta.dir, "inspect-vfx-graphics.py"))) ===
    proof.inspectorSha256,
  "Native graphics inspector changed",
);
requireValue(
  sha(await raw(resolve(import.meta.dir, "render-vfx-graphics.py"))) ===
    summary.rendererSha256,
  "Native graphics renderer changed",
);
for (const [path, expected] of Object.entries(texturePackage.inputs))
  requireValue(
    sha(await raw(path)) === expected,
    `Native texture input changed: ${path}`,
  );
for (const [path, expected] of [
  [
    "decoder-16.21-macos/profile.json",
    "d970900e97da41fc81eab2c81e80082a5b0e14169ba6227af7f5b394878c2d72",
  ],
  [
    "latest-effects/manifest.json",
    "ca91a5a7e79c408d195765a71909e92f9f8c086eb4555cfce7a26cbef03afeb0",
  ],
  [
    "latest-scene/manifest.json",
    "a5c5972a279f7cded9622e79d151b699b0ae24ccdbb7973ec651f6998a62c331",
  ],
])
  requireValue(
    sha(await raw(`${assets}/${path}`)) === expected,
    `Frozen input changed: ${path}`,
  );
const files = new Map(),
  add = async (name) =>
    files.set(`/assets/${name}`, {
      path: `${assets}/${name}`,
      sha256: sha(await raw(`${assets}/${name}`)),
    });
requireValue(
  sha(await raw(`${assets}/evidence/latest-vfx-graphics.png`)) ===
    summary.imageSha256,
  "Native graphics coverage image differs",
);
for (const [name, bytes] of [
  ["native", observation],
  ["inspection", inspection],
]) {
  await Bun.write(`${assets}/evidence/latest-vfx-graphics-${name}.json`, bytes);
  await add(`evidence/latest-vfx-graphics-${name}.json`);
}
await add("evidence/latest-vfx-graphics.png");
await add("evidence/latest-vfx-graphics.json");
await add("latest-native-textures/package.json");
for (const asset of Object.values(texturePackage.assets)) {
  requireValue(
    sha(await raw(`${assets}/latest-native-textures/${asset.file}`)) ===
      asset.sha256 &&
      sha(await raw(`${assets}/latest-native-textures/${asset.rawFile}`)) ===
        asset.sourceSha256,
    "Supplemental native texture changed",
  );
  await add(`latest-native-textures/${asset.file}`);
  await add(`latest-native-textures/${asset.rawFile}`);
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
      `Native graphics preview bytes differ: ${base + url}`,
    );
    httpChecks++;
  }
const result = {
  schema: 1,
  kind: "native-vfx-graphics-preview-publication",
  httpChecks,
  files: Object.fromEntries(files),
  counts: native.counts,
  scope: native.scope,
  publisherSha256: sha(await raw(import.meta.path)),
};
await Bun.write(
  `${cache}/research/vfx-graphics-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({ httpChecks, files: files.size, counts: native.counts }),
);
