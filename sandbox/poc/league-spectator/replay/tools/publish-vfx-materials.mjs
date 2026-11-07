// Validate and expose the native material component and its offscreen visual.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: publish-vfx-materials.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`;
const read = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer());
const sha = (data) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
const materialRaw = await read(`${cache}/research/vfx-materials-native.json`),
  material = JSON.parse(new TextDecoder().decode(materialRaw));
const proofRaw = await read(`${cache}/research/vfx-materials-comparison.json`),
  proof = JSON.parse(new TextDecoder().decode(proofRaw));
const drivesRaw = await read(`${cache}/research/material-drives-native.json`),
  drives = JSON.parse(new TextDecoder().decode(drivesRaw));
if (
  material.kind !== "native-quad-material-observations" ||
  material.build !== "16.21.829.8620" ||
  material.scope.partialCorpus ||
  !material.scope.assetBytesUnchanged ||
  material.counts.emitters !== 2894 ||
  material.counts.shaderSelections !== 2894 * 17 ||
  material.scope.maximumEmittersPerNativeEngine !== 100 ||
  proof.materialPackageSha256 !== sha(materialRaw) ||
  proof.driveEvidenceSha256 !== sha(drivesRaw) ||
  proof.scope.mismatchCount !== 0 ||
  proof.counts.calls !== material.counts.shaderSelections ||
  proof.counts.driveCalls !== drives.counts.drives ||
  proof.moduleSha256 !== sha(await read(`${root}/latest-vfx-materials.mjs`)) ||
  proof.inspectorSha256 !==
    sha(await read(`${root}/tools/inspect-vfx-materials.mjs`))
)
  throw Error("Incomplete native material preparation or component inspection");
for (const source of [material, drives])
  for (const [name, expected] of Object.entries(source.sources))
    if (sha(await read(`${root}/tools/${name}`)) !== expected)
      throw Error(`Stale native material source ${name}`);
for (const child of material.childProcesses)
  if (sha(await read(child.file)) !== child.sha256)
    throw Error("Native material child-process evidence changed");
const visual = await Bun.file(
  `${assets}/evidence/latest-native-materials.json`,
).json();
if (
  visual.rendererSha256 !==
    sha(await read(`${root}/tools/render-native-materials.py`)) ||
  visual.drawAdapterSha256 !==
    sha(await read(`${root}/tools/render-particle-shader.py`)) ||
  visual.imageSha256 !==
    sha(await read(`${assets}/evidence/latest-native-materials.png`)) ||
  visual.samples.length !== 6 ||
  visual.samples.some((s) => s.visiblePixels < 30) ||
  visual.scope.browserRun ||
  visual.scope.mainViewerIntegrated ||
  visual.scope.referencePixelsCompared
)
  throw Error("Incomplete native material shader visual");
for (const [path, expected] of Object.entries(visual.sources))
  if (sha(await read(path)) !== expected)
    throw Error(`Stale native material visual input ${path}`);
const build = await Bun.build({
  entrypoints: [`${root}/latest-vfx-materials.mjs`],
  target: "browser",
  write: false,
});
if (!build.success || build.outputs.length !== 1)
  throw Error("Native material browser component failed to build");
await mkdir(`${assets}/latest-materials`, { recursive: true });
await Bun.write(`${assets}/latest-materials/package.json`, materialRaw);
await Bun.write(`${assets}/latest-materials/runtime.mjs`, build.outputs[0]);
await Bun.write(`${assets}/evidence/vfx-materials.json`, proofRaw);
await Bun.write(`${assets}/evidence/material-drives.json`, drivesRaw);
const paths = [
  "/latest.html",
  "/README.md",
  "/AV-FIDELITY-MAP.md",
  "/latest-vfx-materials.mjs",
  "/assets/latest-materials/package.json",
  "/assets/latest-materials/runtime.mjs",
  "/assets/evidence/vfx-materials.json",
  "/assets/evidence/material-drives.json",
  "/assets/evidence/latest-native-materials.png",
  "/assets/evidence/latest-native-materials.json",
];
const results = [];
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  for (const path of paths) {
    const response = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(30000),
    });
    const bytes = await response.arrayBuffer(),
      file = path.startsWith("/assets/")
        ? `${assets}/${path.slice(8)}`
        : `${root}${path}`;
    if (response.status !== 200 || sha(bytes) !== sha(await read(file)))
      throw Error(`Native material publication mismatch: ${base}${path}`);
    results.push({ base, path, status: response.status, sha256: sha(bytes) });
  }
}
const result = {
  schema: 1,
  kind: "native-material-publication",
  build: material.build,
  materialPackageSha256: sha(materialRaw),
  proofSha256: sha(proofRaw),
  imageSha256: visual.imageSha256,
  publisherSha256: sha(await read(import.meta.path)),
  counts: proof.counts,
  missingPreparedShaders: proof.missingPreparedShaders,
  results,
  scope: {
    browserRun: false,
    mainViewerIntegrated: false,
    resourceAcquisition: false,
    referencePixelsCompared: false,
  },
};
await Bun.write(
  `${cache}/research/vfx-materials-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    matchedFiles: results.length,
    counts: proof.counts,
    missingPreparedShaders: proof.missingPreparedShaders,
  }),
);
