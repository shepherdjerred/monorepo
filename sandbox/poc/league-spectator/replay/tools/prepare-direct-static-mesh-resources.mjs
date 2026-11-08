import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  directStaticMeshGeometry,
  directStaticMeshResourceFields,
} from "../latest-direct-effect-mesh.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const folder = `${cache}/public/latest-direct-static-mesh-resources`;
async function raw(path) {
  path = resolve(path);
  const value = await Bun.file(path).bytes(),
    hash = await sha256(value);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input changed: ${path}`);
  inputs[path] = hash;
  return value;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== profile.decoderImageSha256)
  throw Error("Original decoder image differs");
const manifestPath = `${cache}/public/latest-effects/manifest.json`,
  manifest = await read(manifestPath);
if (
  manifest.build !== profile.clientVersion ||
  manifest.protocol !== profile.protocolDigest
)
  throw Error("Static mesh resource build differs");
const material = await read(
  `${cache}/research/direct-static-mesh-materials/package.json`,
);
const native = await read(
  `${cache}/research/direct-static-mesh-materials/native.json`,
);
if (
  material.kind !== "prepared-direct-static-mesh-materials" ||
  material.effectsManifestSha256 !== inputs[resolve(manifestPath)] ||
  native.kind !== "native-static-mesh-material-observation" ||
  native.decoderImageSha256 !== profile.decoderImageSha256
)
  throw Error("Original prepared static mesh resources required");
const proofs = [];
for (const [name, kind] of [
  [
    "direct-mesh-geometry-comparison.json",
    "ordinary-static-mesh-transform-differential",
  ],
  [
    "direct-mesh-record-comparison.json",
    "direct-static-mesh-cpu-record-comparison",
  ],
  [
    "direct-mesh-world-order-comparison.json",
    "direct-individual-mesh-world-matrix-byte-order-comparison",
  ],
]) {
  const path = `${cache}/research/${name}`,
    proof = await read(path);
  const passed =
    kind === "ordinary-static-mesh-transform-differential"
      ? proof.matrices === 272 &&
        proof.frames === 248 &&
        proof.maxError === 0 &&
        Array.isArray(proof.mismatches) &&
        proof.mismatches.length === 0
      : proof.passed === true;
  if (proof.kind !== kind || !passed)
    throw Error(`Passing mesh kernel proof required: ${name}`);
  for (const [input, expected] of Object.entries(proof.inputs))
    if ((await sha256(await raw(input))) !== expected)
      throw Error(`Mesh proof input changed: ${input}`);
  proofs.push({ name, sha256: inputs[resolve(path)] });
}
const resources = new Map();
async function store(data) {
  const hash = await sha256(data),
    file = `blobs/${hash}.bin`;
  await Bun.write(`${folder}/${file}`, data);
  return { file, sha256: hash, bytes: data.length };
}
for (const emitter of material.emitters) {
  const mesh = emitter.mesh,
    asset = manifest.assets[mesh.path];
  if (
    emitter.primitiveVtableRva !== 0x23f6a80 ||
    !asset ||
    asset.kind !== "static-mesh" ||
    asset.status !== "prepared"
  )
    throw Error("Prepared original static mesh identity required");
  const setups = native.staticMeshSetups.filter(
    (value) => value.path === mesh.path,
  );
  if (setups.length !== 1)
    throw Error("Unique original static mesh setup required");
  const setup = setups[0],
    buffer = native.meshBuffers.find(
      (value) => value.nativePointer === setup.nativeBuffer,
    );
  const vertices = Uint8Array.fromHex(buffer.bytesHex),
    header = Uint8Array.fromHex(setup.headerAfterHex);
  const source = await raw(`${cache}/public/latest-effects/${asset.rawFile}`);
  if (
    (await sha256(source)) !== asset.sourceSha256 ||
    (await sha256(vertices)) !== mesh.vertices.sha256 ||
    buffer.gpuReadbackSha256 !== mesh.vertices.sha256 ||
    !buffer.gpuBytesVerified ||
    mesh.stride !== 36 ||
    mesh.triangles !== setup.triangles
  )
    throw Error("Original SCB resource hashes/shape differ");
  directStaticMeshResourceFields(header);
  directStaticMeshGeometry(vertices, mesh.triangles);
  const value = {
    path: mesh.path,
    source: await store(source),
    resourceHeader: await store(header),
    vertices: await store(vertices),
    triangles: mesh.triangles,
    vertexStride: 36,
    primitiveVtableRva: 0x23f6a80,
  };
  if (
    resources.has(mesh.path) &&
    JSON.stringify(resources.get(mesh.path)) !== JSON.stringify(value)
  )
    throw Error("Conflicting static mesh resource identities");
  resources.set(mesh.path, value);
}
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final static mesh resource input drift: ${path}`);
const result = {
  schema: 1,
  kind: "prepared-direct-static-mesh-resources",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  decoderImageSha256: profile.decoderImageSha256,
  effectsManifestSha256: inputs[resolve(manifestPath)],
  resources: [...resources.values()],
  sourceProofs: proofs,
  scope: {
    staticBuildAssetsOnly: true,
    originalScbBufferAndResourceHeader: true,
    guestPointersInHeaderNeverDereferenced: true,
    particleAndMaterialAdmissionIncluded: false,
    nativeAcceptance: null,
  },
};
const bytes = new TextEncoder().encode(JSON.stringify(result, null, 2));
await Bun.write(`${folder}/package.json`, bytes);
await Bun.write(
  `${cache}/research/direct-static-mesh-resources-preparation.json`,
  JSON.stringify({
    schema: 1,
    kind: "direct-static-mesh-resources-preparation",
    passed: true,
    packageSha256: await sha256(bytes),
    resources: resources.size,
    inputs,
  }),
);
console.log(
  JSON.stringify({
    output: `${folder}/package.json`,
    sha256: await sha256(bytes),
    resources: resources.size,
    inputs: Object.keys(inputs).length,
  }),
);
