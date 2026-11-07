import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const value = await Bun.file(path).bytes(),
    hash = await sha256(value);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Navmesh source input changed");
  inputs[path] = hash;
  return value;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const nativePath = resolve(cache, "research/navmesh-mask-source-native.json"),
  n = await read(nativePath),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
assert.equal(n.kind, "original-navmesh-mask-cpu-source-observation");
assert.equal(n.build, "16.21.829.8620");
assert.equal(n.protocol, "20e09df23c66b85e");
assert.equal(n.decoderImageSha256, profile.decoderImageSha256);
assert.equal(await sha256(image), profile.decoderImageSha256);
assert.equal(n.boundary, null);
assert.equal(n.loader.completed, true);
assert.equal(n.loader.readinessBitsSupplied, false);
assert.equal(n.scope.suppliedReadinessOrRgbaBytes, false);
assert.equal(n.scope.researchSelectedMap12Base, true);
assert.equal(n.scope.decodedMapVariantSelection, false);
assert.equal(n.scope.textureUploadExecuted, false);
assert.equal(n.scope.runtimeAdmissionChanged, false);
assert(Object.keys(n.inputs).length > 0);
for (const [path, hash] of Object.entries(n.inputs))
  assert.equal(await sha256(await raw(path)), hash);
assert(n.originalBlocks.length > 0);
for (const b of n.originalBlocks)
  assert.equal(await sha256(image.subarray(b.rva, b.rva + b.size)), b.sha256);
for (const at of [
  0x14aa563, 0x16b3670, 0x16b6ef0, 0x16bd7e0, 0x16bda63, 0x16bdb00, 0x16adc30,
  0x60c8fb, 0x16bd400, 0x16bd3c0, 0x182bfc0,
])
  assert(
    n.originalBlocks.some((b) => b.rva <= at && at < b.rva + b.size),
    `Required original source entry ${at.toString(16)} absent`,
  );
const o = n.observation,
  rgba = Uint8Array.fromHex(o.rgbaHex),
  flags = new DataView(Uint8Array.fromHex(o.baseCellFlagsHex).buffer);
assert.equal(o.status, "owned-original-cpu-rgba-surface");
assert.equal(o.runtime, n.loader.runtime);
assert(Number.isInteger(o.width) && o.width >= 2 && o.width <= 1024);
assert(Number.isInteger(o.height) && o.height >= 2 && o.height <= 1024);
assert(Number.isSafeInteger(o.rgbaPointer) && o.rgbaPointer > 0);
assert.equal(o.allocationBytes, o.width * o.height * 4);
assert.equal(rgba.length, o.allocationBytes);
assert.equal(flags.byteLength, o.width * o.height * 2);
assert.equal(o.initialCellFlagsCompared, flags.byteLength / 2);
assert.equal(o.dirtyByte, 1);
assert.equal(await sha256(rgba), o.sha256);
assert.deepEqual(
  o.originalArgbInitialization.afterHex,
  "ffffffff00000000000000ff",
);
assert.equal(o.originalArgbInitialization.startRva, 0x14aa563);
assert.equal(o.originalArgbInitialization.endRva, 0x14aa5f9);
assert.equal(
  await sha256(image.subarray(0x14aa563, 0x14aa5f9)),
  o.originalArgbInitialization.sha256,
);
const histogram = {};
for (let i = 0; i < flags.byteLength / 2; i++) {
  const blue = (flags.getUint16(i * 2, true) & 0xc02) === 2 ? 0 : 255;
  assert.deepEqual(Array.from(rgba.subarray(i * 4, i * 4 + 4)), [
    blue,
    blue,
    blue,
    255,
  ]);
  histogram[blue] = (histogram[blue] ?? 0) + 1;
}
assert.deepEqual(histogram, o.blueHistogram);
assert(histogram[0] > 0 && histogram[255] > 0);
const t = o.sceneTransform,
  f = Math.fround,
  size = t.runtimeCellSize;
assert.equal(t.producerStartRva, 0x60c8fb);
assert.equal(t.producerEndRva, 0x60c940);
assert.equal(t.setterRva, 0x182bfc0);
assert.equal(t.globalRva, 0x2549030);
assert.equal(t.originalGlobalStoreExecuted, true);
assert.equal(t.gpuUploadExecuted, false);
assert(Number.isFinite(size) && size > 0);
const extent = [f(o.width * size), 0, f(o.height * size)],
  center = [
    f(f(extent[0] * f(0.5)) + t.runtimeOrigin[0]),
    t.runtimeOrigin[1],
    f(f(extent[2] * f(0.5)) + t.runtimeOrigin[2]),
  ];
assert.deepEqual(t.extent, extent);
assert.deepEqual(t.center, center);
const inverses = [f(1 / extent[0]), f(1 / extent[2])];
const transform = [
  ...inverses,
  ...[0, 2].map((lane, i) =>
    f(f(-f(f(extent[lane] * f(-0.5)) + center[lane])) * inverses[i]),
  ),
];
assert.equal(
  new Uint8Array(Float32Array.from(transform).buffer).toHex(),
  t.afterHex,
);
assert.deepEqual(transform, t.values);
for (const [path, hash] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), hash);
const output = `${cache}/research/navmesh-mask-source-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-navmesh-mask-source-and-transform-comparison",
      inputs,
      nativeReportSha256: inputs[nativePath],
      width: o.width,
      height: o.height,
      rgbaBytes: rgba.length,
      originalCellFlagsCompared: flags.byteLength / 2,
      histogram,
      transformHex: t.afterHex,
      mismatches: [],
      scope: {
        originalFullLoaderAndScalarArgbInitialization: true,
        originalSceneTransformCallsiteExecuted: true,
        researchSelectedMap12Base: true,
        decodedReplayMapVariant: false,
        dynamicCellMutationsCovered: false,
        actualGpuUpload: false,
        blurFade: false,
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
    rgbaBytes: rgba.length,
    cells: flags.byteLength / 2,
    histogram,
    transformHex: t.afterHex,
    fingerprints: Object.keys(inputs).length,
  }),
);
