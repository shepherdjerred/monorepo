import { resolve } from "node:path";
import {
  directStaticMeshGeometry,
  directStaticMeshParticleMatrix,
  directStaticMeshResourceFields,
} from "../latest-direct-effect-mesh.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash) throw Error(`Input drift:${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  fromHex = (hex) => new Uint8Array(Buffer.from(hex, "hex")),
  floats = (bytes, offset, count) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: count }, (_, i) =>
      view.getFloat32(offset + i * 4, true),
    );
  };
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/direct-mesh-geometry-native.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if (
  native.kind !== "original-static-mesh-particle-transform-controls" ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  native.decoderImageSha256 !== (await sha256(image)) ||
  native.cases.length !== 8 ||
  native.leafControls.length !== 24
)
  throw Error("Complete exact-build original mesh controls required");
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Native input changed:${path}`);
for (const block of native.originalBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original mesh instruction changed");
const manifest = await read(`${cache}/public/latest-effects/manifest.json`),
  ref = manifest.definitions[native.effectId],
  definition = await read(`${cache}/public/latest-effects/${ref.file}`),
  source =
    definition.definition.complexEmitterDefinitionData[native.emitterIndex],
  fields = directStaticMeshResourceFields(
    fromHex(native.mesh.resourceHeaderHex),
  ),
  geometry = directStaticMeshGeometry(
    fromHex(native.mesh.vertexBytesHex),
    native.mesh.triangles,
  ),
  mismatches = [];
let matrices = 0,
  lanes = 0,
  frames = 0,
  maxError = 0;
function compare(expectedHex, actual, label) {
  const expected = fromHex(expectedHex),
    bytes = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength),
    e = floats(expected, 0, 16);
  matrices++;
  for (let i = 0; i < 16; i++) {
    lanes++;
    const error = Math.abs(e[i] - actual[i]);
    maxError = Math.max(maxError, error);
    if (!Object.is(e[i], actual[i]))
      mismatches.push({
        label,
        lane: i,
        expected: e[i],
        actual: actual[i],
        expectedBits: Buffer.from(expected).readUInt32LE(i * 4),
        actualBits: Buffer.from(bytes).readUInt32LE(i * 4),
      });
  }
}
for (const c of native.leafControls) {
  const matrix = [...c.rotationMatrix];
  matrix.splice(12, 3, ...c.position);
  compare(
    c.matrixHex,
    directStaticMeshParticleMatrix({
      particleMatrix: matrix,
      scale: c.scale,
      uniformScale: false,
      systemScale: [1, 1],
      resourceFields: fields,
    }),
    `leaf:${matrices}`,
  );
}
for (const c of native.cases)
  for (const frame of c.frames) {
    frames++;
    const snapshot = frame.output.state,
      particle = fromHex(snapshot.vectors.particle.hex),
      attributes = fromHex(snapshot.vectors.attributes.hex),
      mat = frame.output.geometry;
    if (snapshot.vectors.particle.count !== mat.matrixHex.length)
      throw Error("Missing original particle matrix");
    for (let index = 0; index < mat.matrixHex.length; index++)
      compare(
        mat.matrixHex[index],
        directStaticMeshParticleMatrix({
          particleMatrix: floats(particle, index * 0xac + 0x50, 16),
          scale: floats(attributes, index * 0x2c + 0x14, 3),
          uniformScale: !!source.isUniformScale,
          systemScale: mat.systemScale,
          resourceFields: fields,
        }),
        `${c.pose}:${c.seedHex}:${frame.input.time}:${index}`,
      );
  }
const sourceMesh = manifest.assets[native.mesh.path],
  scb = await raw(`${cache}/public/latest-effects/${sourceMesh.rawFile}`),
  view = new DataView(scb.buffer, scb.byteOffset, scb.byteLength);
if (
  (await sha256(scb)) !== native.mesh.sourceSha256 ||
  (await sha256(fromHex(native.mesh.vertexBytesHex))) !==
    native.mesh.vertexBytesSha256
)
  throw Error("Native static resource bytes changed");
if (
  new TextDecoder().decode(scb.subarray(0, 8)) !== "r3d2Mesh" ||
  ![
    [2, 2],
    [3, 2],
  ].some(
    ([a, b]) => view.getUint16(8, true) === a && view.getUint16(10, true) === b,
  )
)
  throw Error("Unsupported SCB version");
const vertexCount = view.getUint32(140, true),
  triangles = view.getUint32(144, true);
let start = 176,
  hasColors = false;
if (view.getUint16(8, true) === 3) {
  hasColors = view.getUint32(start, true) === 1;
  start += 4;
}
const faces = start + vertexCount * 12 + (hasColors ? vertexCount * 4 : 0) + 12;
if (
  triangles !== geometry.triangles ||
  faces + triangles * 100 > scb.byteLength
)
  throw Error("SCB triangles out of bounds");
let positionLanes = 0,
  uvLanes = 0;
for (let triangle = 0; triangle < triangles; triangle++)
  for (let corner = 0; corner < 3; corner++) {
    const face = faces + triangle * 100,
      index = view.getUint32(face + corner * 4, true),
      at = triangle * 3 + corner;
    if (index >= vertexCount) throw Error("SCB index out of bounds");
    for (let lane = 0; lane < 3; lane++) {
      if (
        !Object.is(
          geometry.positions[at * 3 + lane],
          view.getFloat32(start + index * 12 + lane * 4, true),
        )
      )
        throw Error("Native SCB position differs");
      positionLanes++;
    }
    for (let lane = 0; lane < 2; lane++) {
      if (
        !Object.is(
          geometry.uv[at * 2 + lane],
          view.getFloat32(face + 76 + lane * 12 + corner * 4, true),
        )
      )
        throw Error("Native SCB UV differs");
      uvLanes++;
    }
  }
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final input drift:${path}`);
const result = {
  schema: 1,
  kind: "ordinary-static-mesh-transform-differential",
  effectId: native.effectId,
  emitterIndex: native.emitterIndex,
  cases: native.cases.length,
  frames,
  leafControls: native.leafControls.length,
  matrices,
  lanes,
  meshVertices: geometry.vertexCount,
  positionLanes,
  uvLanes,
  maxError,
  mismatches,
  inputs,
  scope: {
    originalUnchangedEmitterInputs: true,
    original173c0b0And180a0a0Executed: true,
    nativeScbVertexBufferDecoded: true,
    normalsPreservedInMeshSpace: true,
    instance208ByteBufferTranslated: false,
    groundMaterialAndUvBindingComplete: false,
    runtimeIntegrated: false,
    renderedCoverageEstablished: false,
    nativeAcceptance: null,
  },
};
const output = resolve(cache, "research/direct-mesh-geometry-comparison.json");
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    ...result,
    inputs: Object.keys(inputs).length,
    mismatches: mismatches.slice(0, 10),
  }),
);
if (mismatches.length) process.exitCode = 1;
