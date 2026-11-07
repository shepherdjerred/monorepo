// Native/offscreen component evidence; this does not publish a playback feature.
import { resolve } from "node:path";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: publish-vfx-pipelines.mjs <cache>");
const cache = resolve(arg),
  assets = `${cache}/public`,
  raw = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer()),
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  requireValue = (value, message) => {
    if (!value) throw Error(message);
  },
  nativeBytes = await raw(`${cache}/research/vfx-pipelines-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  proofBytes = await raw(`${cache}/research/vfx-pipelines-inspection.json`),
  proof = JSON.parse(new TextDecoder().decode(proofBytes)),
  contractsBytes = await raw(`${cache}/research/vfx-pipeline-contracts.json`),
  contracts = JSON.parse(new TextDecoder().decode(contractsBytes)),
  summary = await read(`${assets}/evidence/latest-vfx-pipelines.json`);
requireValue(
  native.kind === "native-vfx-pipeline-observations" &&
    native.build === "16.21.829.8620" &&
    proof.observationSha256 === sha(nativeBytes) &&
    proof.nativeContractsSha256 === sha(contractsBytes) &&
    contracts.observationSha256 === sha(nativeBytes) &&
    proof.mismatchCount === 0 &&
    proof.checks.completeRoots === 876 &&
    proof.checks.activatedParents === 509 &&
    proof.checks.nativePipelineDescriptions === 1728 &&
    proof.checks.nativeUniformBufferCopies === 4476 &&
    proof.checks.materialSamplerBindings === 4834 &&
    proof.checks.createdActorSnapshots === 1616 &&
    contracts.counts.uniquePipelineDescriptors === 114 &&
    contracts.counts.uniqueUniformCopies === 438 &&
    contracts.counts.uniqueSamplerDescriptors === 6 &&
    summary.populatedDefinitionsWithActors === 425 &&
    summary.observationSha256 === sha(nativeBytes) &&
    summary.inspectionSha256 === sha(proofBytes) &&
    summary.nativeContractsSha256 === sha(contractsBytes) &&
    native.scope.renderPipelineStateProviderImplemented &&
    !native.scope.sceneGlobalsBound &&
    !native.scope.mainViewerIntegrated &&
    !native.scope.renderedCoverageEstablished &&
    !native.scope.browserOrLeagueExecuted,
  "Incomplete native pipeline component evidence",
);
for (const [path, expected] of Object.entries(native.inputs))
  requireValue(
    sha(await raw(path)) === expected,
    `Pipeline input changed: ${path}`,
  );
for (const record of [native, contracts])
  for (const [name, expected] of Object.entries(record.sources))
    requireValue(
      sha(await raw(resolve(import.meta.dir, name))) === expected,
      `Pipeline source changed: ${name}`,
    );
requireValue(
  sha(await raw(resolve(import.meta.dir, "inspect-vfx-graphics.py"))) ===
    proof.inspectorSha256,
  "Pipeline inspector changed",
);
requireValue(
  sha(await raw(resolve(import.meta.dir, "render-vfx-pipelines.py"))) ===
    summary.rendererSha256,
  "Pipeline coverage renderer changed",
);
requireValue(
  sha(await raw(`${cache}/research/latest-shaders/pairs.json`)) ===
    proof.pairTableSha256,
  "Pipeline independent shader-pair table changed",
);
const image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
requireValue(
  sha(image) === native.decoderImageSha256,
  "Pipeline executable image changed",
);
for (const record of [native, contracts])
  for (const block of record.originalBlocks)
    requireValue(
      sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
      "Pipeline original executed code changed",
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
    files.set(`/assets/evidence/${name}`, {
      path: `${assets}/evidence/${name}`,
      sha256: sha(await raw(`${assets}/evidence/${name}`)),
    });
for (const [name, bytes] of [
  ["native", nativeBytes],
  ["inspection", proofBytes],
  ["contracts", contractsBytes],
]) {
  const file = `latest-vfx-pipelines-${name}.json`;
  await Bun.write(`${assets}/evidence/${file}`, bytes);
  await add(file);
}
requireValue(
  sha(await raw(`${assets}/evidence/latest-vfx-pipelines.png`)) ===
    summary.imageSha256,
  "Pipeline coverage image differs",
);
await add("latest-vfx-pipelines.png");
await add("latest-vfx-pipelines.json");
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
      `Pipeline preview bytes differ: ${base + url}`,
    );
    httpChecks++;
  }
const result = {
  schema: 1,
  kind: "native-vfx-pipelines-preview-publication",
  httpChecks,
  files: Object.fromEntries(files),
  counts: native.counts,
  scope: native.scope,
  publisherSha256: sha(await raw(import.meta.path)),
};
await Bun.write(
  `${cache}/research/vfx-pipelines-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({ httpChecks, files: files.size, counts: native.counts }),
);
