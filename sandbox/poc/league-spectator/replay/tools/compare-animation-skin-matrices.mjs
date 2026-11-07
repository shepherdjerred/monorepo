// Compare original CPU skin-matrix preparation in native and browser-capable WASM.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  NativeVfxSpawnKernel,
  spawnPreviewMath,
} from "../latest-vfx-spawn.mjs";

const [cachePath] = process.argv.slice(2);
if (!cachePath)
  throw Error("Usage: bun compare-animation-skin-matrices.mjs <cache>");
const cache = resolve(cachePath),
  inputs = {};
const hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
async function raw(path) {
  path = resolve(path);
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  inputs[path] = hash(bytes);
  return bytes;
}
const json = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
const native = await json(
  `${cache}/research/animation-skin-matrices-native.json`,
);
const source = await json(
  `${cache}/research/animation-graph-preparation-dispatch-native.json`,
);
const profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if (
  native.boundary ||
  native.build !== "16.21.829.8620" ||
  native.build !== profile.clientVersion ||
  profile.protocolDigest !== "20e09df23c66b85e" ||
  hash(image) !== profile.decoderImageSha256 ||
  native.decoderImageSha256 !== hash(image) ||
  source.decoderImageSha256 !== hash(image) ||
  source.cases.length !== 1 ||
  source.cases[0].actor !== native.actor ||
  source.cases[0].boundary
)
  throw Error(
    "Exact original native skin/world pose evidence and image required",
  );
for (const report of [native, source.cases[0]]) {
  for (const [path, expected] of Object.entries(report.inputs))
    if (hash(await raw(path)) !== expected)
      throw Error(`Native input changed: ${path}`);
  for (const [name, expected] of Object.entries(report.sources))
    if (hash(await raw(`${import.meta.dir}/${name}`)) !== expected)
      throw Error(`Native producer changed: ${name}`);
}
const spawnBytes = await raw(
  `${cache}/public/decoder-16.21-macos/vfx-spawn.json`,
);
const vendor = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
if (
  hash(spawnBytes) !== profile.vfxSpawnSha256 ||
  hash(await raw(vendor)) !==
    "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716"
)
  throw Error("Pinned spawn substrate and browser WASM runtime required");
const { default: createUnicorn } = await import(pathToFileURL(vendor).href);
const uc = await createUnicorn();
const kernel = new NativeVfxSpawnKernel(
  uc,
  profile,
  image,
  JSON.parse(new TextDecoder().decode(spawnBytes)),
  null,
  spawnPreviewMath,
);
const e = kernel.engine,
  skin = native.skinMatrices,
  poses = source.cases[0].animationPoses;
const count = skin.jointCount,
  rig = 0x10040000,
  rows = 0x10041000,
  pose = 0x10049000,
  world = 0x10050000,
  output = 0x10060000,
  canary = 0x10091000;
const fromHex = (value) => {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{2})+$/.test(value))
    throw Error("Complete native hexadecimal bytes required");
  return Uint8Array.from(value.match(/../g), (v) => parseInt(v, 16));
};
const u32 = (at, value) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  e.mem_write(at, bytes);
};
let samples = 0,
  reversedSamples = 0,
  comparedFloatLanes = 0;
const mismatches = [];
try {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 256 ||
    poses.joints.length !== count ||
    skin.inverseBindPosesHex.length !== count ||
    skin.resources.length !== poses.resources.length ||
    skin.originalMatrixPreparationRva !== 0x1586f40
  )
    throw Error("Bounded original skin-matrix contract required");
  kernel.u64(kernel.base + 0x22e0310, canary);
  kernel.u64(canary, 0x7766554433221100n);
  e.mem_write(rig, new Uint8Array(0x98));
  e.mem_write(pose, new Uint8Array(0x120));
  e.mem_write(rows, new Uint8Array(count * 0x70));
  kernel.u64(rig + 0x28, rows);
  u32(rig + 0x30, count);
  kernel.u64(pose + 0x70, rig);
  kernel.u64(pose + 8, world);
  skin.inverseBindPosesHex.forEach((value, i) => {
    const bytes = fromHex(value);
    if (bytes.length !== 40)
      throw Error("Original inverse-bind transform size differs");
    e.mem_write(rows + i * 0x70 + 0x48, bytes);
  });
  const work = skin.resources.flatMap((resource, i) => {
    const original = poses.resources[i];
    if (
      resource.key !== original.key ||
      resource.samples.length !== original.samples.length ||
      !original.completed
    )
      throw Error("Native skin/world sample resource order differs");
    return resource.samples.map((sample, j) => ({
      resource: i,
      index: j,
      sample,
      world: original.samples[j],
    }));
  });
  for (const reverse of [false, true])
    for (const item of reverse ? [...work].reverse() : work) {
      if (item.sample.time !== item.world.time || !item.world.worldValid)
        throw Error("Original native sample time/validity differs");
      const worldBytes = fromHex(item.world.worldPosesHex),
        expected = fromHex(item.sample.matrices3x4Hex);
      if (worldBytes.length !== count * 40 || expected.length !== count * 48)
        throw Error("Bounded native skin/world sample sizes required");
      e.mem_write(world, worldBytes);
      e.mem_write(output, new Uint8Array(count * 48 + 0x100).fill(0xa5));
      kernel.callNative(0x1586f40, { RDI: pose, RSI: output });
      const actual = kernel.read(output, count * 48);
      if (
        kernel.read(output + count * 48, 0x100).some((v) => v !== 0xa5) ||
        kernel
          .read(world, worldBytes.length)
          .some((v, i) => v !== worldBytes[i])
      )
        throw Error(
          "Original WASM skin-matrix pass changed its input or escaped its guard",
        );
      for (let at = 0; at < expected.length; at += 4)
        if (actual.subarray(at, at + 4).some((v, i) => v !== expected[at + i]))
          mismatches.push({
            resource: item.resource,
            sample: item.index,
            reverse,
            lane: at / 4,
          });
      if (reverse) reversedSamples++;
      else {
        samples++;
        comparedFloatLanes += count * 12;
      }
    }
} finally {
  e.close();
}
for (const name of [
  "latest-vfx-spawn.mjs",
  "native-decoder.mjs",
  "structural-comparison.mjs",
])
  await raw(`${import.meta.dir}/../${name}`);
const report = {
  schema: 1,
  kind: "original-skin-matrices-wasm-comparison",
  build: native.build,
  inputs,
  sourceSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  counts: {
    samples,
    reversedSamples,
    jointMatrices: samples * count,
    comparedFloatLanes,
  },
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 10),
  scope: {
    originalInverseBindPreparationCompared: true,
    suppliedVerifiedNativeWorldPoses: true,
    suppliedVerifiedNativeStaticRig: true,
    nativeAnmEvaluatorRunsInBrowser: false,
    gpuSkinning: false,
    recordedAnimationSelection: false,
    mainViewerExpanded: false,
  },
};
const path = `${cache}/research/animation-skin-matrices-wasm-comparison.json`;
await Bun.write(path, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    output: path,
    counts: report.counts,
    mismatchCount: report.mismatchCount,
  }),
);
if (mismatches.length) process.exitCode = 1;
