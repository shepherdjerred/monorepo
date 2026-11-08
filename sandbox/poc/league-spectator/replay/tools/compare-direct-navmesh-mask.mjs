import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import {
  directNavmeshMask4x,
  DIRECT_NAVMESH_MASK_TABLE_SHA,
} from "../latest-direct-navmesh-mask.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Navmesh proof input changed");
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/direct-navmesh-mask-native.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
assert.equal(await sha256(image), profile.decoderImageSha256);
assert.equal(native.schema, 1);
assert.equal(native.kind, "native-navmesh-mask-fourfold-expansion-controls");
assert.equal(native.build, "16.21.829.8620");
assert.equal(native.protocol, "20e09df23c66b85e");
assert.equal(profile.clientVersion, native.build);
assert.equal(profile.protocolDigest, native.protocol);
assert.deepEqual(Object.keys(native.inputs).sort().length > 0, true);
for (const [path, hash] of Object.entries(native.inputs)) {
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await sha256(await raw(path)), hash);
}
assert.equal(native.table.rva, 0x20d6bd0);
assert.equal(native.table.size, 256);
assert.equal(native.table.sha256, DIRECT_NAVMESH_MASK_TABLE_SHA);
assert.equal(
  await sha256(Uint8Array.fromHex(native.table.bytesHex)),
  DIRECT_NAVMESH_MASK_TABLE_SHA,
);
assert.equal(
  image.subarray(native.table.rva, native.table.rva + 256).toHex(),
  native.table.bytesHex,
);
assert.deepEqual(
  native.originalBlocks.map((b) => [b.rva, b.size]),
  [
    [0x740e60, 0x1f5],
    [0x741055, 0x1eb],
    [0x741240, 0x34],
  ],
);
for (const b of native.originalBlocks)
  assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
assert.equal(native.scope.contiguousOriginalCpuExpansionExecuted, true);
assert.equal(native.scope.suppliedPreviousOutputSurface, true);
assert.equal(native.scope.actualReplayNavgridSurfaceRecovered, false);
assert.equal(native.scope.textureUploadExecuted, false);
assert.equal(native.scope.runtimeAdmissionChanged, false);

const expected = new Map();
function add(label, width, height, rgba) {
  for (const pattern of ["zero", "a5", "gradient"]) {
    const previous = Uint8Array.from({ length: width * height * 16 }, (_, i) =>
      pattern === "zero" ? 0 : pattern === "a5" ? 165 : (i * 43 + 17) % 256,
    );
    expected.set(`${label}-prior-${pattern}`, {
      width,
      height,
      rgbaHex: rgba.toHex(),
      previousHex: previous.toHex(),
    });
  }
}
for (let code = 0; code < 16; code++)
  add(
    `corners-${code}`,
    2,
    2,
    Uint8Array.from(
      { length: 16 },
      (_, i) =>
        [17, 93, code & (1 << Math.floor(i / 4)) ? 129 : 128, 201][i % 4],
    ),
  );
for (const [w, h] of [
  [2, 3],
  [3, 2],
  [3, 3],
  [5, 4],
  [7, 5],
  [32, 17],
]) {
  for (const level of [0, 127, 128, 129, 255])
    add(
      `uniform-${w}-${h}-${level}`,
      w,
      h,
      Uint8Array.from(
        { length: w * h * 4 },
        (_, i) => [3, 41, level, 199][i % 4],
      ),
    );
  add(
    `gradient-${w}-${h}`,
    w,
    h,
    Uint8Array.from({ length: w * h * 4 }, (_, i) => {
      const cell = Math.floor(i / 4);
      return [
        cell % 256,
        (cell * 17) % 256,
        (cell * 73 + 128) % 256,
        (cell * 37) % 256,
      ][i % 4];
    }),
  );
}
function validateCases(cases) {
  assert.equal(cases.length, expected.size);
  const seen = new Set();
  for (const c of cases) {
    assert(!seen.has(c.label));
    seen.add(c.label);
    const e = expected.get(c.label);
    assert(e);
    assert.deepEqual(
      {
        width: c.width,
        height: c.height,
        rgbaHex: c.rgbaHex,
        previousHex: c.previousHex,
      },
      e,
    );
    assert.equal(c.outputWidth, c.width * 4);
    assert.equal(c.outputHeight, c.height * 4);
    assert.match(c.outputHex, /^[0-9a-f]+$/);
    assert.equal(c.outputHex.length, c.width * c.height * 32);
  }
}
validateCases(native.cases);
let rejectionControls = 0;
for (const mutate of [
  (c) => c.pop(),
  (c) => c.push(c[0]),
  (c) => (c[1] = c[0]),
  (c) => (c[0].rgbaHex = "00".repeat(16)),
  (c) => (c[0].previousHex = "ff".repeat(64)),
  (c) => c[0].outputWidth++,
  (c) => (c[0].outputHex = ""),
]) {
  const copy = structuredClone(native.cases);
  mutate(copy);
  assert.throws(() => validateCases(copy));
  rejectionControls++;
}
let bytesCompared = 0,
  independentCopyChecks = 0;
for (const c of native.cases) {
  const rgba = Uint8Array.fromHex(c.rgbaHex),
    previous = Uint8Array.fromHex(c.previousHex);
  const result = directNavmeshMask4x({ ...c, rgba, previous });
  assert.equal(result.width, c.outputWidth);
  assert.equal(result.height, c.outputHeight);
  assert.equal(result.bytes.toHex(), c.outputHex);
  assert.equal(rgba.toHex(), c.rgbaHex);
  assert.equal(previous.toHex(), c.previousHex);
  assert.notEqual(result.bytes.buffer, rgba.buffer);
  assert.notEqual(result.bytes.buffer, previous.buffer);
  bytesCompared += result.bytes.length;
  independentCopyChecks++;
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash);
const output = `${cache}/research/direct-navmesh-mask-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "direct-js-navmesh-mask-fourfold-comparison",
      inputs,
      cases: native.cases.length,
      bytesCompared,
      independentCopyChecks,
      rejectionControls,
      mismatches: [],
      scope: {
        exactNativeExpansionBytes: true,
        allCornerThresholdAndRetainedPriorCases: true,
        actualMapRgbaProducerRecovered: false,
        actualGraphicsSettingRecovered: false,
        textureUploadExecuted: false,
        blurFadeImplemented: false,
        runtimeAdmissionChanged: false,
        browserExecuted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    cases: native.cases.length,
    bytesCompared,
    independentCopyChecks,
    rejectionControls,
  }),
);
