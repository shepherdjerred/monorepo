import { resolve } from "node:path";
import {
  directStaticMeshCpuRecord,
  directStaticMeshDrawParameters,
} from "../latest-direct-effect-mesh-record.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input drift: ${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const bytes = (hex) => new Uint8Array(Buffer.from(hex, "hex"));
function floatArray(hex) {
  const value = bytes(hex),
    view = new DataView(value.buffer);
  return Array.from({ length: value.length / 4 }, (_, i) =>
    view.getFloat32(i * 4, true),
  );
}
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/direct-mesh-record-native.json`);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
const geometrySource = await read(
  `${cache}/research/direct-mesh-geometry-native.json`,
);
const resourceOffset40 = floatArray(
  geometrySource.mesh.resourceHeaderHex,
).slice(0x40 / 4, 0x40 / 4 + 3);
if (
  native.kind !== "original-static-mesh-cpu-record-controls" ||
  native.recordBytes !== 176 ||
  native.cases.length !== 16 ||
  native.suppliedLeafControls.length !== 8 ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  native.decoderImageSha256 !== (await sha256(image))
)
  throw Error("Complete exact-build original mesh record controls required");
for (const [path, hash] of Object.entries(native.inputs)) {
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Native input changed: ${path}`);
}
for (const block of native.originalBlocks) {
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original mesh record instruction changed");
}
const mismatches = [];
let records = 0,
  comparedBytes = 0,
  frames = 0,
  drawParameters = 0;
function compare(input, matrixHex, expectedHex, label) {
  const { attributesHex, ...fields } = input;
  const actual = directStaticMeshCpuRecord({
    ...fields,
    matrix: floatArray(matrixHex),
    attributes: bytes(attributesHex),
  });
  const expected = bytes(expectedHex);
  if (actual.length !== expected.length || actual.length !== 176)
    throw Error("Mesh record output shape changed");
  records++;
  for (let i = 0; i < expected.length; i++) {
    comparedBytes++;
    if (actual[i] !== expected[i])
      mismatches.push({
        label,
        byte: i,
        expected: expected[i],
        actual: actual[i],
      });
  }
}
for (const [i, control] of native.suppliedLeafControls.entries())
  compare(control.input, control.matrixHex, control.recordHex, `leaf:${i}`);
for (const c of native.cases)
  for (const [index, frame] of c.frames.entries()) {
    frames++;
    const g = frame.output.geometry;
    if (
      g.record176Hex.length !== g.recordInputs.length ||
      g.recordInputs.length !== g.matrixHex.length
    )
      throw Error("Original record/matrix identity differs");
    for (let i = 0; i < g.record176Hex.length; i++) {
      compare(
        g.recordInputs[i],
        g.matrixHex[i],
        g.record176Hex[i],
        `${c.seedHex}:${c.pose}:${index}:${i}`,
      );
      const params = directStaticMeshDrawParameters({
        record: bytes(g.record176Hex[i]),
        resourceOffset40,
        paletteByte: 0,
        multTexturePresent: false,
      });
      const observed = g.drawInputs[i];
      for (const [name, hexName] of [
        ["mWorld", "mWorldHex"],
        ["kColorFactor", "kColorFactorHex"],
        ["vParticleUVTransform", "vParticleUVTransformHex"],
        ["DYNAMIC_MESH_CENTER", "dynamicMeshCenterHex"],
      ]) {
        const actual = new Uint8Array(params[name].buffer),
          expected = bytes(observed[hexName]);
        drawParameters++;
        for (let lane = 0; lane < expected.length; lane++)
          if (actual[lane] !== expected[lane])
            mismatches.push({
              label: `draw:${name}:${c.pose}:${index}`,
              byte: lane,
              expected: expected[lane],
              actual: actual[lane],
            });
      }
    }
  }
if (frames !== 496 || records !== 504)
  throw Error("Original mesh record cohort incomplete");
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final input drift: ${path}`);
const report = {
  schema: 1,
  kind: "direct-static-mesh-cpu-record-comparison",
  passed: mismatches.length === 0,
  records,
  frames,
  suppliedLeafControls: native.suppliedLeafControls.length,
  comparedBytes,
  drawParameters,
  mismatches,
  inputs,
  scope: {
    originalTemplateAndWriter: true,
    unchangedHecarim15ParticleInputs: true,
    suppliedMatrixInputs: true,
    facingProviders: "explicitly-not-admitted",
    authoredUvClassificationAndNativeMatrixComposition: true,
    originalIndividualDrawParameterPrefixes: true,
    cpuRecordContainsRawWorldMatrix: true,
    namedMWorldMatchesOriginalMatrixSetterPackedBytes: true,
    inverseWorldAndProjectionRemainExplicitInputs: true,
    dx11Instance208BytePackingEstablished: false,
    runtimeIntegrated: false,
    gpuDrawSubmitted: false,
    nativeAcceptance: null,
  },
};
await Bun.write(
  `${cache}/research/direct-mesh-record-comparison.json`,
  JSON.stringify(report),
);
console.log(
  JSON.stringify({
    passed: report.passed,
    records,
    frames,
    comparedBytes,
    mismatches: mismatches.slice(0, 12),
    inputs: Object.keys(inputs).length,
  }),
);
if (!report.passed) process.exitCode = 1;
