// Native/offscreen resource evidence, independent of browser replay acceptance.
import { resolve } from "node:path";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: publish-vfx-meshes.mjs <cache>");
const cache = resolve(arg),
  assets = `${cache}/public`,
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  requireValue = (v, m) => {
    if (!v) throw Error(m);
  },
  nativeBytes = await raw(`${cache}/research/vfx-meshes-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  proofBytes = await raw(`${cache}/research/vfx-meshes-inspection.json`),
  proof = JSON.parse(new TextDecoder().decode(proofBytes)),
  contractsBytes = await raw(
    `${cache}/research/vfx-meshes-pipeline-contracts.json`,
  ),
  contracts = JSON.parse(new TextDecoder().decode(contractsBytes)),
  summary = await read(`${assets}/evidence/latest-vfx-meshes.json`);
requireValue(
  native.kind === "native-vfx-meshes-observations" &&
    native.build === "16.21.829.8620" &&
    native.protocol === "20e09df23c66b85e" &&
    proof.observationSha256 === sha(nativeBytes) &&
    proof.mismatchCount === 0 &&
    proof.checks.completeRoots === 876 &&
    proof.checks.activatedParents === native.counts.activated &&
    proof.checks.gpuMeshBuffers === native.counts.meshBuffers &&
    proof.checks.independentScbPositionsAndUvs ===
      native.counts.staticMeshSetups &&
    proof.nativeContractsSha256 === sha(contractsBytes) &&
    contracts.observationSha256 === sha(nativeBytes) &&
    summary.observationSha256 === sha(nativeBytes) &&
    summary.inspectionSha256 === sha(proofBytes) &&
    summary.scope.originalVertexBytes &&
    summary.scope.gpuAttributeStateQueried &&
    summary.scope.diagnosticShader &&
    !native.scope.sceneGlobalsBound &&
    !native.scope.mainViewerIntegrated &&
    !native.scope.renderedCoverageEstablished &&
    !summary.scope.browserExecuted &&
    !summary.scope.originalMaterials,
  "Incomplete native mesh resource evidence",
);
for (const record of [native, contracts])
  for (const [name, expected] of Object.entries(record.sources))
    requireValue(
      sha(await raw(resolve(import.meta.dir, name))) === expected,
      `Mesh resource source changed: ${name}`,
    );
for (const [path, expected] of Object.entries(native.inputs))
  requireValue(
    sha(await raw(path)) === expected,
    `Mesh resource input changed: ${path}`,
  );
for (const [name, expected] of Object.entries({
  "inspect-vfx-graphics.py": proof.inspectorSha256,
  "inspect_mesh_resources.py": proof.meshInspectorSha256,
  "render-vfx-meshes.py": summary.rendererSha256,
  "graphics_mesh_attributes.py": summary.attributeBinderSha256,
}))
  requireValue(
    sha(await raw(resolve(import.meta.dir, name))) === expected,
    `Mesh verifier/renderer changed: ${name}`,
  );
const image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
requireValue(
  sha(image) === native.decoderImageSha256,
  "Mesh executable image changed",
);
for (const record of [native, contracts])
  for (const block of record.originalBlocks)
    requireValue(
      sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
      "Mesh original executed code changed",
    );
const files = new Map();
const compressed = Bun.gzipSync(nativeBytes);
requireValue(
  sha(Bun.gunzipSync(compressed)) === sha(nativeBytes),
  "Compressed mesh observation differs",
);
for (const [name, bytes] of [
  ["latest-vfx-meshes-native.json.gz", compressed],
  ["latest-vfx-meshes-inspection.json", proofBytes],
  ["latest-vfx-meshes-contracts.json", contractsBytes],
]) {
  const path = `${assets}/evidence/${name}`;
  await Bun.write(path, bytes);
  files.set(`/assets/evidence/${name}`, { path, sha256: sha(bytes) });
}
requireValue(
  sha(await raw(`${assets}/evidence/latest-vfx-meshes.png`)) ===
    summary.imageSha256,
  "Mesh geometry image differs",
);
for (const name of ["latest-vfx-meshes.png", "latest-vfx-meshes.json"]) {
  const path = `${assets}/evidence/${name}`;
  files.set(`/assets/evidence/${name}`, { path, sha256: sha(await raw(path)) });
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
      `Mesh evidence preview bytes differ: ${base + url}`,
    );
    httpChecks++;
  }
const result = {
  schema: 1,
  kind: "native-vfx-meshes-preview-publication",
  httpChecks,
  files: Object.fromEntries(files),
  observationSha256: sha(nativeBytes),
  compressedBytes: compressed.length,
  uncompressedBytes: nativeBytes.length,
  counts: native.counts,
  scope: native.scope,
  publisherSha256: sha(await raw(import.meta.path)),
};
await Bun.write(
  `${cache}/research/vfx-meshes-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    httpChecks,
    files: files.size,
    counts: native.counts,
    compressedBytes: compressed.length,
  }),
);
