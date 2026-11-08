import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { directNavgridTransform } from "../latest-direct-navgrid-transform.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const value = await Bun.file(path).bytes(),
    hash = await sha256(value);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Navgrid transform input changed");
  inputs[path] = hash;
  return value;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
    `${cache}/research/direct-navgrid-transform-native.json`,
  ),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
assert.equal(native.kind, "native-navgrid-shader-transform-controls");
assert.equal(native.schema, 1);
assert.equal(native.build, "16.21.829.8620");
assert.equal(native.protocol, "20e09df23c66b85e");
assert.equal(await sha256(image), profile.decoderImageSha256);
assert.equal(profile.clientVersion, native.build);
assert.equal(profile.protocolDigest, native.protocol);
assert(Object.keys(native.inputs).length > 0);
for (const [path, hash] of Object.entries(native.inputs))
  assert.equal(await sha256(await raw(path)), hash);
assert.deepEqual(
  native.originalBlocks.map((b) => [b.rva, b.size]),
  [
    [0x182bfc0, 0x44],
    [0x60c8fb, 0x45],
    [0x16bd3c0, 0xa0],
    [0x20ca0d0, 16],
    [0x20d6e80, 16],
    [0x20ca120, 16],
  ],
);
for (const b of native.originalBlocks)
  assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
assert.equal(native.scope.originalSetterExecuted, true);
assert.equal(native.scope.actualMapGettersExecuted, false);
assert.equal(native.scope.originalUniformUploadExecuted, false);
assert.equal(native.scope.runtimeAdmissionChanged, false);
const controls = [
  [
    [0, 0, 0],
    [100, 0, 200],
  ],
  [
    [50, 0, 100],
    [100, 0, 200],
  ],
  [
    [123.5, -77, -456.25],
    [37, 0, 109],
  ],
  [
    [-1000, 7, 2500],
    [500, 19, 10000],
  ],
  [
    [6603.411, 0, 6243.991],
    [12400, 0, 11850],
  ],
  [
    [1, 0, -1],
    [0.001, 0, 0.003],
  ],
  [
    [0, 3, 0],
    [1e30, -123, 1e-30],
  ],
  [
    [123.5, 99, -456.25],
    [37, 1234, 109],
  ],
];
const expected = new Set(
  controls.map((row) => JSON.stringify(row.map((v) => v.map(Math.fround)))),
);
function validateCases(cases) {
  assert.equal(cases.length, 8);
  const remaining = new Set(expected);
  for (const c of cases) {
    assert(
      remaining.delete(JSON.stringify([c.center, c.extent])),
      "Exact unique eight native inputs required",
    );
    assert.match(c.outputHex, /^[0-9a-f]{32}$/);
  }
  assert.equal(remaining.size, 0);
}
validateCases(native.cases);
let rejectionControls = 0;
for (const mutate of [
  (c) => c.pop(),
  (c) => c.push(c[0]),
  (c) => (c[1] = c[0]),
  (c) => c[0].center[0]++,
  (c) => (c[0].outputHex = ""),
]) {
  const copy = structuredClone(native.cases);
  mutate(copy);
  assert.throws(() => validateCases(copy));
  rejectionControls++;
}
const hex = (a) => new Uint8Array(a.buffer).toHex();
for (const c of native.cases) {
  const before = structuredClone(c),
    first = directNavgridTransform(c);
  assert.equal(hex(first), c.outputHex);
  first.fill(17);
  assert.equal(hex(directNavgridTransform(c)), c.outputHex);
  assert.deepEqual(c, before);
}
const actualProof = await read(
    `${cache}/research/navmesh-mask-source-comparison.json`,
  ),
  actualNativePath = resolve(cache, "research/navmesh-mask-source-native.json"),
  actual = await read(actualNativePath);
assert.equal(
  actualProof.kind,
  "original-navmesh-mask-source-and-transform-comparison",
);
assert.deepEqual(actualProof.mismatches, []);
assert.equal(actualProof.nativeReportSha256, inputs[actualNativePath]);
for (const [path, hash] of Object.entries(actualProof.inputs))
  assert.equal(await sha256(await raw(path)), hash);
assert.equal(actual.boundary, null);
const t = actual.observation.sceneTransform;
assert.equal(t.originalGlobalStoreExecuted, true);
assert.equal(t.gpuUploadExecuted, false);
assert.equal(hex(directNavgridTransform(t)), t.afterHex);
assert.equal(t.afterHex, actualProof.transformHex);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash);
const output = `${cache}/research/direct-navgrid-transform-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "direct-js-original-navgrid-transform-comparison",
      inputs,
      suppliedControls: 8,
      actualOriginalGetterAndSetterCases: 1,
      float32ValuesCompared: 36,
      rejectionControls,
      actualTransformHex: t.afterHex,
      mismatches: [],
      scope: {
        exactFloat32AndSignedZero: true,
        originalActualGetterInputsCompared: true,
        researchSelectedMap12Base: true,
        decodedMapVariantSelection: false,
        originalGpuUpload: false,
        runtimeAdmissionChanged: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    controls: 8,
    actualLoadedCases: 1,
    float32ValuesCompared: 36,
    rejectionControls,
    fingerprints: Object.keys(inputs).length,
  }),
);
