// Publish inspected resource evidence, with no browser or fidelity claims.
import { resolve } from "node:path";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: publish-dds-cubes.mjs <cache>");
const cache = resolve(arg),
  assets = `${cache}/public`,
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  requireValue = (v, m) => {
    if (!v) throw Error(m);
  },
  packageBytes = await raw(`${assets}/latest-dds-cubes/package.json`),
  cubes = JSON.parse(new TextDecoder().decode(packageBytes)),
  nativeBytes = await raw(`${cache}/research/vfx-cubemaps-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  proofBytes = await raw(`${cache}/research/vfx-cubemaps-inspection.json`),
  proof = JSON.parse(new TextDecoder().decode(proofBytes)),
  contractsBytes = await raw(
    `${cache}/research/vfx-cubemaps-pipeline-contracts.json`,
  ),
  contracts = JSON.parse(new TextDecoder().decode(contractsBytes)),
  drawing = await read(`${assets}/evidence/latest-dds-cubes.json`),
  baselineBytes = await raw(`${cache}/research/vfx-meshes-native.json`),
  baseline = JSON.parse(new TextDecoder().decode(baselineBytes)),
  baselineProof = await read(`${cache}/research/vfx-meshes-inspection.json`);
requireValue(
  cubes.kind === "prepared-dds-cubemaps" &&
    cubes.build === "16.21.829.8620" &&
    cubes.protocol === "20e09df23c66b85e" &&
    cubes.counts.uniqueCubes === 3 &&
    cubes.counts.subresources === 54 &&
    native.kind === "native-vfx-cubemaps-observations" &&
    native.build === cubes.build &&
    native.protocol === cubes.protocol &&
    native.scope.allOriginalDdsCubeFacesAndMipsPrepared &&
    !native.scope.sceneGlobalsBound &&
    !native.scope.mainViewerIntegrated &&
    !native.scope.renderedCoverageEstablished &&
    !native.scope.browserOrLeagueExecuted &&
    proof.observationSha256 === sha(nativeBytes) &&
    proof.mismatchCount === 0 &&
    proof.checks.completeRoots === 876 &&
    proof.checks.activatedParents === native.counts.activated &&
    proof.checks.cubeMaterialBindings > 0 &&
    proof.checks.ddsCubePlanes > 0 &&
    proof.nativeContractsSha256 === sha(contractsBytes) &&
    contracts.observationSha256 === sha(nativeBytes) &&
    drawing.packageSha256 === sha(packageBytes) &&
    drawing.counts.exactSamplerDraws === 54 &&
    drawing.counts.gpuSubresources === 54 &&
    drawing.draws.length === 54 &&
    drawing.draws.every((d) => d.exact) &&
    drawing.scope.samplerCubeDrawsCompared &&
    drawing.scope.diagnosticShader &&
    !drawing.scope.browserExecuted &&
    !drawing.scope.originalMaterials &&
    !drawing.scope.mainViewerIntegrated &&
    baselineProof.observationSha256 === sha(baselineBytes) &&
    baselineProof.mismatchCount === 0 &&
    baseline.cases.length === 876 &&
    native.cases.length === 876,
  "Incomplete cubemap preparation/native/draw evidence",
);
for (const record of [cubes, native, contracts]) {
  for (const [name, expected] of Object.entries(record.sources))
    requireValue(
      sha(await raw(resolve(import.meta.dir, name))) === expected,
      `Cubemap source changed: ${name}`,
    );
  for (const [path, expected] of Object.entries(record.inputs ?? {}))
    requireValue(
      sha(await raw(path)) === expected,
      `Cubemap input changed: ${path}`,
    );
}
for (const [name, expected] of Object.entries({
  "inspect-vfx-graphics.py": proof.inspectorSha256,
  "inspect_mesh_resources.py": proof.meshInspectorSha256,
  "dds_cube.py": proof.cubeDecoderSha256,
  "render-dds-cubes.py": drawing.rendererSha256,
}))
  requireValue(
    sha(await raw(resolve(import.meta.dir, name))) === expected,
    `Cubemap inspector/renderer changed: ${name}`,
  );
for (const [path, expected] of Object.entries(drawing.inputs))
  requireValue(
    sha(await raw(path)) === expected,
    `Cube draw source changed: ${path}`,
  );
requireValue(
  drawing.cubeDecoderSha256 === proof.cubeDecoderSha256,
  "Draw/native cube importers differ",
);
const image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
requireValue(
  sha(image) === native.decoderImageSha256,
  "Native cubemap executable image changed",
);
for (const record of [native, contracts])
  for (const block of record.originalBlocks)
    requireValue(
      sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
      "Executed native cube code changed",
    );
const previous = new Map(baseline.cases.map((c) => [c.effectId, c]));
const newlyActivated = [],
  regressed = [];
for (const current of native.cases) {
  const before = previous.get(current.effectId);
  requireValue(
    before &&
      before.graphSha256 === current.graphSha256 &&
      before.randomSeed.input === current.randomSeed.input &&
      JSON.stringify(before.clockInput) === JSON.stringify(current.clockInput),
    "Native cube baseline input differs",
  );
  if (before.status === "activated" && current.status !== "activated")
    regressed.push(current.effectId);
  if (before.status !== "activated" && current.status === "activated")
    newlyActivated.push(current.effectId);
}
requireValue(
  regressed.length === 0,
  "Cubemap implementation regresses earlier native activations",
);
const files = new Map();
async function add(url, path, expected) {
  const bytes = await raw(path),
    digest = sha(bytes);
  requireValue(
    !expected || digest === expected,
    `Cube published file differs: ${path}`,
  );
  const existing = files.get(url);
  requireValue(
    !existing || existing.sha256 === digest,
    "Cube publication URL collides",
  );
  files.set(url, { path, sha256: digest });
}
await add(
  "/assets/latest-dds-cubes/package.json",
  `${assets}/latest-dds-cubes/package.json`,
  sha(packageBytes),
);
for (const cube of Object.values(cubes.cubes))
  for (const level of cube.levels)
    for (const plane of level) {
      await add(
        `/assets/latest-dds-cubes/${plane.file}`,
        `${assets}/latest-dds-cubes/${plane.file}`,
        plane.sha256,
      );
      await add(
        `/assets/latest-dds-cubes/${plane.preview}`,
        `${assets}/latest-dds-cubes/${plane.preview}`,
        plane.previewSha256,
      );
    }
const compressed = Bun.gzipSync(nativeBytes);
requireValue(
  sha(Bun.gunzipSync(compressed)) === sha(nativeBytes),
  "Compressed cube observation differs",
);
for (const [name, bytes] of [
  ["latest-dds-cubes-native.json.gz", compressed],
  ["latest-dds-cubes-inspection.json", proofBytes],
  ["latest-dds-cubes-contracts.json", contractsBytes],
]) {
  const path = `${assets}/evidence/${name}`;
  await Bun.write(path, bytes);
  await add(`/assets/evidence/${name}`, path, sha(bytes));
}
await add(
  "/assets/evidence/latest-dds-cubes.png",
  `${assets}/evidence/latest-dds-cubes.png`,
  drawing.imageSha256,
);
await add(
  "/assets/evidence/latest-dds-cubes.json",
  `${assets}/evidence/latest-dds-cubes.json`,
);
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
      `Cubemap evidence HTTP bytes differ: ${base + url}`,
    );
    httpChecks++;
  }
const result = {
  schema: 1,
  kind: "dds-cube-evidence-publication",
  observationSha256: sha(nativeBytes),
  baselineObservationSha256: sha(baselineBytes),
  baselineActivated: baseline.counts.activated,
  newlyActivated,
  regressed,
  counts: native.counts,
  cubeCounts: cubes.counts,
  inspectionChecks: proof.checks,
  scope: native.scope,
  files: Object.fromEntries(files),
  httpChecks,
  publisherSha256: sha(await raw(import.meta.path)),
};
await Bun.write(
  `${cache}/research/dds-cubes-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    httpChecks,
    files: files.size,
    newlyActivated: newlyActivated.length,
    regressed: regressed.length,
    activated: native.counts.activated,
    boundaries: native.counts.boundaries,
    cubeChecks: proof.checks.cubeMaterialBindings,
  }),
);
