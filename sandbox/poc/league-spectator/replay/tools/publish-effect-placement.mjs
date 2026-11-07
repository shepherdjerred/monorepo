import { resolve, dirname } from "node:path";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: publish-effect-placement.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`;
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  read = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer()),
  json = async (path) => JSON.parse(new TextDecoder().decode(await read(path)));
const requireThat = (ok, message) => {
  if (!ok) throw Error(message);
};
const nativePath = `${cache}/research/effect-placement-native.json`,
  proofPath = `${cache}/research/effect-placement-comparison.json`,
  packagePath = `${assets}/latest-effect-placement/package.json`,
  visualPath = `${assets}/evidence/latest-effect-placement.json`,
  gridPath = `${cache}/research/effect-placement-grid-native.bin`;
const native = await json(nativePath),
  proof = await json(proofPath),
  meta = await json(packagePath),
  visual = await json(visualPath),
  image = await read(`${decoder}/image.bin`),
  gridBytes = await read(gridPath),
  scene = await json(`${assets}/latest-scene/manifest.json`);
requireThat(
  meta.build === "16.21.829.8620" &&
    meta.protocol === "20e09df23c66b85e" &&
    meta.decoderImageSha256 === sha(image) &&
    native.packageSha256 === sha(await read(packagePath)) &&
    proof.packageSha256 === native.packageSha256 &&
    proof.nativeEvidenceSha256 === sha(await read(nativePath)) &&
    native.gridOracleSha256 === sha(gridBytes) &&
    native.preparerSha256 ===
      sha(await read(`${root}/tools/prepare-effect-placement.py`)) &&
    proof.inspectorSha256 ===
      sha(await read(`${root}/tools/inspect-effect-placement.mjs`)) &&
    visual.rendererSha256 ===
      sha(await read(`${root}/tools/render-effect-placement.py`)) &&
    visual.comparisonSha256 === sha(await read(proofPath)) &&
    visual.imageSha256 ===
      sha(await read(`${assets}/evidence/latest-effect-placement.png`)) &&
    proof.mismatches.length === 0 &&
    JSON.stringify(visual.counts) === JSON.stringify(proof.counts) &&
    proof.scope.mapInitializationExecuted &&
    proof.scope.packetVectorGettersExecuted &&
    !proof.scope.entityOverrideExecuted &&
    !proof.scope.attachmentPoseExecuted &&
    !proof.scope.factoryExecuted &&
    !proof.scope.renderingIntegrated &&
    !proof.scope.browserRun &&
    !proof.scope.mainViewerIntegrated &&
    !proof.scope.leagueReferenceCompared,
  "Placement proof missing or changed",
);
for (const record of [native, proof, visual])
  for (const [path, expected] of Object.entries(record.inputs))
    requireThat(
      sha(await read(path)) === expected,
      `Stale placement input: ${path}`,
    );
for (const [name, expected] of Object.entries(proof.sources))
  requireThat(
    sha(await read(`${root}/${name}`)) === expected,
    `Stale placement source: ${name}`,
  );
for (const block of meta.sourceBlocks)
  requireThat(
    sha(image.subarray(block.startRva, block.endRva)) === block.sha256,
    "Original placement block changed",
  );
const grid = new DataView(
    gridBytes.buffer,
    gridBytes.byteOffset,
    gridBytes.byteLength,
  ),
  scratch = new DataView(new ArrayBuffer(4)),
  bits = (value) => {
    scratch.setFloat32(0, value, true);
    return scratch.getUint32(0, true);
  };
let gridChecks = 0;
for (const origin of meta.origin)
  for (let value = -32768; value < 32768; value++) {
    requireThat(
      bits(Math.fround(origin + Math.fround(value * 2))) ===
        grid.getUint32(gridChecks * 4, true),
      "Grid oracle disagrees with map conversion",
    );
    gridChecks++;
  }
const outside = [];
for (const [index, record] of proof.records.entries()) {
  const nativeRecord = native.records[index],
    vectors = [
      record.primaryPacketPosition,
      record.secondaryPacketVector,
      record.tertiaryPacketVector,
    ];
  requireThat(
    record.creationSequence === index &&
      record.groupIndex === nativeRecord.groupIndex &&
      record.entryIndex === nativeRecord.entryIndex &&
      JSON.stringify(record.additionalFields) ===
        JSON.stringify(nativeRecord.fields) &&
      JSON.stringify(vectors.map((vector) => vector.map(bits))) ===
        JSON.stringify(nativeRecord.vectorBits) &&
      JSON.stringify(record.vectorBits) ===
        JSON.stringify(nativeRecord.vectorBits) &&
      record.packetVectorsResolved &&
      !record.worldPlacementResolved &&
      !record.entityOverrideResolved &&
      !record.attachmentPoseResolved,
    "Placement record bits differ from native",
  );
  const [x, , z] = record.primaryPacketPosition;
  if (!(
    x >= scene.map.min[0] &&
    x <= scene.map.max[0] &&
    z >= scene.map.min[2] &&
    z <= scene.map.max[2]
  ))
    outside.push(index);
}
requireThat(
  proof.counts.entryChecks === native.counts.entries &&
    proof.records.length === native.records.length &&
    proof.counts.vectors === proof.records.length * 3 &&
    proof.counts.floatChecks === proof.records.length * 9 &&
    proof.counts.gridChecks === gridChecks &&
    gridChecks * 4 === gridBytes.length &&
    proof.counts.mixedChecks === native.mixedProbes.length &&
    proof.counts.packetPositionsInsideMap ===
      proof.records.length - outside.length &&
    proof.counts.attachmentEntityReferences ===
      proof.records.filter((record) => record.attachmentEntityId !== 0)
        .length &&
    JSON.stringify(outside) === JSON.stringify(visual.outsideNavigationBounds),
  "Placement/visual count differs",
);
const build = await Bun.build({
  entrypoints: [`${root}/latest-effect-placement.mjs`],
  target: "browser",
});
requireThat(
  build.success && build.outputs.length === 1,
  "Placement component browser-target build failed",
);
const paths = new Map();
for (const [name, path] of [
  ["effect-placement-native.json", nativePath],
  ["effect-placement-comparison.json", proofPath],
  ["effect-placement-grid-native.bin", gridPath],
]) {
  await Bun.write(`${assets}/evidence/${name}`, await read(path));
  paths.set(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
}
for (const name of [
  "latest-effect-placement.png",
  "latest-effect-placement.json",
])
  paths.set(`/assets/evidence/${name}`, `${assets}/evidence/${name}`);
for (const name of ["latest-effect-placement", "latest-effect-creation"])
  paths.set(`/assets/${name}/package.json`, `${assets}/${name}/package.json`);
paths.set(
  "/assets/latest-scene/manifest.json",
  `${assets}/latest-scene/manifest.json`,
);
for (const name of ["profile.json", "image.bin", "constructors.bin"])
  paths.set(`/assets/decoder-16.21-macos/${name}`, `${decoder}/${name}`);
const visited = new Set();
async function includeModule(file) {
  if (visited.has(file)) return;
  visited.add(file);
  paths.set(`/${file.slice(root.length + 1).replaceAll("\\", "/")}`, file);
  for (const match of (await Bun.file(file).text()).matchAll(
    /(?:from\s*|import\s*\()\s*["'](\.\.?\/[^"']+\.mjs)["']/g,
  ))
    await includeModule(resolve(dirname(file), match[1]));
}
await includeModule(`${root}/latest-effect-placement.mjs`);
for (const name of ["README.md", "AV-FIDELITY-MAP.md"])
  paths.set(`/${name}`, `${root}/${name}`);
const checks = [];
for (const origin of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
])
  for (const [path, file] of paths) {
    const response = await fetch(`${origin}${path}`, {
        signal: AbortSignal.timeout(30000),
      }),
      expected = sha(await read(file));
    requireThat(
      response.status === 200 && sha(await response.arrayBuffer()) === expected,
      `Placement publication differs: ${origin}${path}`,
    );
    checks.push({ url: `${origin}${path}`, sha256: expected });
  }
await Bun.write(
  `${cache}/research/effect-placement-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      publisherSha256: sha(await read(import.meta.path)),
      comparisonSha256: sha(await read(proofPath)),
      imageSha256: visual.imageSha256,
      counts: proof.counts,
      scope: proof.scope,
      checks,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ matchedFiles: checks.length, counts: proof.counts }),
);
