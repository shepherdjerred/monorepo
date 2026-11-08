import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import {
  DIRECT_NAVMESH_FILTER_DEFAULTS as defaults,
  directNavmeshFadeParameters as fade,
  directNavmeshBlurParameters as blur,
} from "../latest-direct-navmesh-filter-math.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Navmesh filter drift:${path}`);
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  bits = (v) => new Uint8Array(new Float32Array(v).buffer).toHex();
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/navmesh-filter-math-native.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
assert.equal(native.kind, "original-navmesh-filter-parameter-fragments");
assert.equal(native.build, profile.clientVersion);
assert.equal(native.protocol, profile.protocolDigest);
assert.equal(native.decoderImageSha256, await sha256(image));
assert.equal(native.decoderImageSha256, profile.decoderImageSha256);
for (const [path, hash] of Object.entries(native.inputs))
  assert.equal(await sha256(await raw(path)), hash);
const expectedBlocks = new Set([
  "7400e3:14",
  "740cef:30",
  "7414ba:34",
  "741565:20",
]);
for (const b of native.originalBlocks) {
  assert(expectedBlocks.delete(`${b.rva.toString(16)}:${b.size.toString(16)}`));
  assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
}
assert.equal(expectedBlocks.size, 0);
assert.deepEqual(native.defaults, defaults);
const clockMatrix = [
    [0, 0],
    [1, 0],
    [0, 1],
    [0.1, 0],
    [10000.1, 10000],
    [1e6 + 0.1, 1e6],
    [-10, -11],
    [1e-20, 0],
    [0.123456789, 0.111111111],
  ],
  expectedClocks = new Set(clockMatrix.map((v) => bits(v))),
  dimensions = [
    [1, 1],
    [256, 512],
    [512, 256],
    [16777217, 0xffffffff],
    [0xffffffff, 16777217],
  ],
  coefficients = [
    [defaults.centerWeight, defaults.sideWeight, defaults.radius],
    [0.5, 0.25, 1],
    [1, 0, 0],
    [-0.5, 2, -3],
    [1e-10, 1e10, 0.123456789],
  ],
  expectedBlur = new Set(
    dimensions.flatMap(([w, h]) =>
      coefficients.map((v) => `${w}:${h}:${bits(v)}`),
    ),
  );
let lanes = 0;
for (const row of native.fades) {
  assert(expectedClocks.delete(bits([row.now, row.lastUpdate])));
  assert.equal(bits(fade(row.now, row.lastUpdate)), row.parameters.hex);
  lanes += 4;
}
for (const row of native.blurs) {
  assert(
    expectedBlur.delete(
      `${row.width}:${row.height}:${bits([row.manager.centerWeight, row.manager.sideWeight, row.manager.radius])}`,
    ),
  );
  const actual = blur(row.width, row.height, row.manager);
  assert.equal(bits(actual.horizontal), row.horizontal.hex);
  assert.equal(bits(actual.vertical), row.vertical.hex);
  lanes += 8;
}
assert.equal(expectedClocks.size, 0);
assert.equal(expectedBlur.size, 0);
for (const hash of [
  "98a98b9fb3b0f8ac1e60d1d2c1d986f6e5f245bc4f6c2d8d1c3b2ff0462ab3e5",
  "8d191c51e4cecea3adb01c254a8778c487fe835a483699a74456bd029efe18cc",
])
  await raw(
    `${cache}/public/latest-shared-shaders-navmask-v29/stages/${hash}.json`,
  );
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash);
const result = {
  schema: 1,
  kind: "navmesh-filter-parameter-native-differential",
  inputs,
  counts: {
    fadeCases: native.fades.length,
    blurCases: native.blurs.length,
    bitExactFloat32Lanes: lanes,
  },
  mismatches: [],
  scope: {
    originalFadeAndBlurParameterFragmentsCompared: true,
    ownedExplicitClockManagerAndDimensions: true,
    shaderSampleMathFromPreparedShaderSource: true,
    shaderSampleGpuCompared: false,
    textureSamplingImplemented: false,
    targetMaskProducerImplemented: false,
    r8QuantizationImplemented: false,
    wholeOriginalProducerCompared: false,
    browserPlayback: false,
  },
};
const output = `${cache}/research/navmesh-filter-math-comparison.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output, ...result.counts, mismatches: 0 }));
