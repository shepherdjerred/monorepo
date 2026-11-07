import { resolve } from "node:path";
import { directStaticMeshDrawParameters } from "../latest-direct-effect-mesh-record.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const value = await Bun.file(path).bytes(),
    hash = await sha256(value);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Input drift: ${path}`);
  inputs[path] = hash;
  return value;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const fromHex = (text) => new Uint8Array(Buffer.from(text, "hex"));
function transposed(bytes) {
  if (bytes.length !== 64) throw Error("Exact native matrix bytes required");
  const result = new Uint8Array(64);
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 4; column++) {
      const offset = (row + column * 4) * 4;
      result.set(bytes.subarray(offset, offset + 4), (column + row * 4) * 4);
    }
  return result;
}
const equal = (a, b) =>
  a.length === b.length && a.every((value, index) => value === b[index]);
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
  `${cache}/research/direct-mesh-world-order-native.json`,
);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if (
  native.kind !== "original-individual-mesh-world-matrix-byte-order" ||
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  native.decoderImageSha256 !== (await sha256(image)) ||
  native.cases.length !== 4 ||
  new Set(native.cases.map((value) => value.pose)).size !== 4
)
  throw Error("Complete original matrix byte order controls required");
for (const [path, hash] of Object.entries({
  ...native.inputs,
  ...native.sources,
}))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Native input changed: ${path}`);
for (const block of native.originalBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original matrix setter instruction changed");
const controls = [];
let laneComparisons = 0;
for (const c of native.cases) {
  const record = fromHex(c.record176Hex),
    source = record.subarray(0, 64);
  const helper = directStaticMeshDrawParameters({
    record,
    resourceOffset40: [0, 0, 0],
    paletteByte: 0,
    multTexturePresent: false,
  });
  const helperBytes = new Uint8Array(helper.mWorld.buffer);
  if (!equal(helperBytes, fromHex(c.sharedValues.mWorld)))
    throw Error("Named mWorld uniform differs from original post-setter bytes");
  for (const name of ["mWorld", "mWorldInv"]) {
    const original = c.setterInputs.filter((value) => value.name === name);
    if (
      original.length !== 1 ||
      original[0].callerRva !== (name === "mWorld" ? 0x1809c1e : 0x1809c5d)
    )
      throw Error("Unexpected original individual matrix setter caller");
    const before = fromHex(original[0].bytesHex),
      after = fromHex(c.sharedValues[name]);
    if (name === "mWorld" && !equal(before, source))
      throw Error("Original setter input differs from CPU record world matrix");
    if (!equal(transposed(before), after))
      throw Error(
        "Original matrix setter does not match bit-preserving transpose",
      );
    if (equal(before, after))
      throw Error(
        "Matrix control is vacuous: original and transposed values equal",
      );
    laneComparisons += 16;
  }
  if (
    c.materialApplyCallerRva !== 0x1809c7b ||
    c.useInstanceDrawHex !== "00".repeat(16)
  )
    throw Error("Individual native draw branch not retained");
  controls.push({
    pose: c.pose,
    rawCpuRecordEqualsSetterInput: true,
    sharedWorldEqualsTranspose: true,
    sharedWorldInverseEqualsTranspose: true,
    rawAndSharedWorldBytesDiffer: true,
  });
}
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Final input drift: ${path}`);
const report = {
  schema: 1,
  kind: "direct-individual-mesh-world-matrix-byte-order-comparison",
  passed: true,
  controls,
  laneComparisons,
  inputs,
  contract: {
    cpuRecordWorldStage: "raw-original-1916f70-input",
    namedDrawParameterWorldStage: "final-post-1916f70-shared-parameter",
    originalSetterOperation: "bit-preserving-4x4-transpose",
    reflectedUniformPackingRequiresFurtherTranspose: false,
    transposeAlreadyAppliedToCapturedSharedValues: true,
  },
  scope: {
    originalObjectPlacementAndParticleUpdate: true,
    completeIndividualRouteThroughMaterialApplyEntry: true,
    projectionAndInverseMathTranslationEstablished: false,
    gpuDrawSubmitted: false,
    nativeAcceptance: null,
  },
};
await Bun.write(
  `${cache}/research/direct-mesh-world-order-comparison.json`,
  JSON.stringify(report),
);
console.log(
  JSON.stringify({
    passed: true,
    cases: controls.length,
    laneComparisons,
    inputs: Object.keys(inputs).length,
    contract: report.contract,
  }),
);
