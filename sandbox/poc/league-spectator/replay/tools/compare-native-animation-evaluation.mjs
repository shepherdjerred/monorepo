// Execute original loaded ANM samplers in the browser-capable WASM runtime.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  NativeVfxSpawnKernel,
  spawnPreviewMath,
} from "../latest-vfx-spawn.mjs";

const [cachePath] = process.argv.slice(2);
if (!cachePath)
  throw Error("Usage: bun compare-native-animation-evaluation.mjs <cache>");
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
const meta = await json(
  `${cache}/research/static-native-animation-evaluation.json`,
);
const blob = await raw(
  `${cache}/research/static-native-animation-evaluation.bin`,
);
const native = await json(
  `${cache}/research/animation-graph-preparation-dispatch-native.json`,
);
const profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`);
const nativeSkin = await json(
  `${cache}/research/animation-skin-matrices-native.json`,
);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if (
  meta.boundary ||
  meta.schema !== 1 ||
  meta.kind !== "function-scoped-native-animation-inputs" ||
  meta.build !== "16.21.829.8620" ||
  meta.protocol !== "20e09df23c66b85e" ||
  profile.clientVersion !== meta.build ||
  profile.protocolDigest !== meta.protocol ||
  hash(image) !== profile.decoderImageSha256 ||
  hash(image) !== meta.decoderImageSha256 ||
  hash(blob) !== meta.binarySha256 ||
  native.cases.length !== 1 ||
  native.cases[0].boundary ||
  native.cases[0].actor !== meta.actor ||
  nativeSkin.boundary ||
  nativeSkin.actor !== meta.actor ||
  nativeSkin.build !== meta.build ||
  !meta.scope.staticAssetInputsOnly ||
  meta.scope.containsReplayEvents ||
  meta.scope.containsSampledAnimations ||
  meta.scope.processSnapshot
)
  throw Error("Exact complete static ANM inputs and native reference required");
for (const report of [meta, native.cases[0], nativeSkin]) {
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
  throw Error(
    "Pinned original substrate and browser-capable WASM runtime required",
  );
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn();
const zeroService = profile.modeledServices.find((p) => p.rva === 0x1fee5fa);
if (
  zeroService?.service !== "___bzero" ||
  zeroService.bytesHex !== "e9ac8b620090" ||
  hash(image.subarray(0x1fee5fa, 0x1fee600)) !==
    hash(Uint8Array.from([0xe9, 0xac, 0x8b, 0x62, 0x00, 0x90]))
)
  throw Error("Exact original bzero ABI/profile binding required");
class NativeAnimationKernel extends NativeVfxSpawnKernel {
  service(at) {
    if (at !== 0x1fee5fa) return super.service(at);
    const dest = Number(this.engine.reg_read_i64(this.uc.X86_REG_RDI)),
      size = Number(this.engine.reg_read_i64(this.uc.X86_REG_RSI));
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > 0x100000 ||
      ![...this.allocations].some(
        ([base, length]) => dest >= base && dest + size <= base + length,
      )
    )
      throw Error("Original ANM bzero exceeds a current owned allocation");
    this.services.bzero = (this.services.bzero ?? 0) + 1;
    this.engine.mem_write(dest, new Uint8Array(size));
    this.ret();
  }
}
const spawnDefinition = JSON.parse(new TextDecoder().decode(spawnBytes));
const k = new NativeAnimationKernel(
  uc,
  profile,
  image,
  { ...spawnDefinition, services: [...spawnDefinition.services, 0x1fee5fa] },
  null,
  spawnPreviewMath,
);
const e = k.engine,
  count = meta.rig.jointCount,
  pose = meta.poseTemplate.address;
const mapping = 0x10070000,
  indices = 0x10071000,
  cacheOwner = 0x10072000,
  root = 0x10090000,
  canary = 0x10091000;
k.services = {};
const skinOutput = 0x10080000;
k.births = [];
k.mathCalls = [];
const unhex = (value) => {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{2})+$/.test(value))
    throw Error("Complete native bytes required");
  return Uint8Array.from(value.match(/../g), (v) => parseInt(v, 16));
};
const u32 = (at, value) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, value, true);
  e.mem_write(at, b);
};
const mismatch = (bytes, expected) =>
  bytes.reduce((sum, v, i) => sum + (v !== expected[i] ? 1 : 0), 0);
const observations = [],
  mismatches = [];
let samples = 0,
  jointPoses = 0,
  phase = "static-input-validation",
  boundary = null;
try {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 256 ||
    meta.resources.length !== native.cases[0].animationPoses.resources.length
  )
    throw Error("Bounded original rig/resource set required");
  const ranges = [];
  let heap = 0x10400000,
    offset = 0;
  for (const segment of meta.segments) {
    if (
      !Number.isSafeInteger(segment.address) ||
      !Number.isSafeInteger(segment.size) ||
      segment.size <= 0 ||
      segment.address < 0x10400000 ||
      segment.address + segment.size > 0x12000000 ||
      segment.offset !== offset ||
      ranges.some(
        ([a, b]) => segment.address < b && a < segment.address + segment.size,
      )
    )
      throw Error("Static ANM segments overlap or exceed explicit bounds");
    const bytes = blob.subarray(segment.offset, segment.offset + segment.size);
    if (bytes.length !== segment.size || hash(bytes) !== segment.sha256)
      throw Error("Static ANM segment changed");
    e.mem_write(segment.address, bytes);
    ranges.push([segment.address, segment.address + segment.size]);
    heap = Math.max(heap, segment.address + segment.size);
    offset += segment.size;
  }
  if (offset !== blob.length) throw Error("Trailing static ANM bytes");
  heap = Math.ceil(heap / 16) * 16;
  const template = meta.segments.filter((s) =>
    meta.poseTemplate.segments.includes(s.address),
  );
  if (
    template.length !== meta.poseTemplate.segments.length ||
    !template.some((s) => s.address === pose)
  )
    throw Error("Complete original pose template required");
  k.u64(k.base + 0x22e0310, canary);
  k.u64(canary, 0x7766554433221100n);
  e.mem_write(
    root,
    unhex(native.cases[0].animationPoses.worldPoseControl.rootHex),
  );
  e.hook_add(
    uc.HOOK_CODE,
    () => e.emu_stop(),
    null,
    k.base + 0x1588a19,
    k.base + 0x1588a19,
  );
  // Original animation static-module block initializes the missing-offset
  // sentinel. A cold image contains zero here, which is a valid data offset.
  // Execute the original instruction rather than supply a sentinel value.
  e.hook_add(
    uc.HOOK_CODE,
    () => e.emu_stop(),
    null,
    k.base + 0x15dcd18,
    k.base + 0x15dcd18,
  );
  k.callNative(0x15dcd0e, {}, 0x15dcd18);
  phase = "original-anm-evaluation";
  for (const resource of meta.resources) {
    const expected =
      native.cases[0].animationPoses.resources[resource.sourceIndex];
    const skinExpected =
      nativeSkin.skinMatrices.resources[resource.sourceIndex];
    if (
      !expected.completed ||
      Number(BigInt(`0x${resource.keyHex}`)) !== expected.key ||
      resource.kind !== expected.kind ||
      skinExpected.key !== expected.key ||
      skinExpected.samples.length !== expected.samples.length ||
      JSON.stringify(resource.trackIndices) !==
        JSON.stringify(expected.trackIndices) ||
      resource.trackIndices.length !== count ||
      resource.evaluatorRva !==
        (resource.kind === "compressed"
          ? 0x15b0b30
          : resource.kind === "uncompressed"
            ? 0x15b53e0
            : 0)
    )
      throw Error("Static/native ANM resource identity or evaluator differs");
    k.nextHeap = heap;
    k.allocations = new Map();
    k.u64(mapping, indices);
    u32(mapping + 8, count);
    u32(mapping + 12, count);
    const trackBytes = new Uint8Array(count * 4),
      trackView = new DataView(trackBytes.buffer);
    resource.trackIndices.forEach((value, i) =>
      trackView.setInt32(i * 4, value, true),
    );
    e.mem_write(indices, trackBytes);
    let animationCache = 0;
    if (resource.kind === "compressed") {
      e.mem_write(cacheOwner, new Uint8Array(0x170).fill(0xa5));
      k.callNative(0x15889f8, { RDI: cacheOwner }, 0x1588a19);
      animationCache = cacheOwner + 0x58;
    }
    const record = {
      sourceIndex: resource.sourceIndex,
      keyHex: resource.keyHex,
      kind: resource.kind,
      samples: [],
    };
    observations.push(record);
    for (const [index, sample] of expected.samples.entries()) {
      for (const s of template)
        e.mem_write(s.address, blob.subarray(s.offset, s.offset + s.size));
      const started = performance.now();
      k.callNative(
        resource.evaluatorRva,
        { RDI: resource.address, RSI: pose, RDX: mapping, RCX: animationCache },
        null,
        { XMM0: sample.time },
      );
      if ((e.reg_read_i64(uc.X86_REG_RAX) & 255n) !== 1n)
        throw Error("Original WASM ANM evaluator did not return success");
      const address = k.q(pose + 8),
        local = k.read(address, count * 40),
        localExpected = unhex(sample.localPosesHex);
      const localByteMismatches = mismatch(local, localExpected);
      k.callNative(0x15852a0, { RDI: pose, RSI: root, RDX: 1 });
      const world = k.read(address, count * 40),
        worldByteMismatches = mismatch(world, unhex(sample.worldPosesHex));
      e.mem_write(skinOutput, new Uint8Array(count * 48 + 0x100).fill(0xa5));
      k.callNative(0x1586f40, { RDI: pose, RSI: skinOutput });
      const skinBytes = k.read(skinOutput, count * 48),
        skinSample = skinExpected.samples[index];
      if (skinSample.time !== sample.time)
        throw Error("Original skin-matrix sample time differs");
      const skinByteMismatches = mismatch(
        skinBytes,
        unhex(skinSample.matrices3x4Hex),
      );
      if (
        k
          .read(meta.poseTemplate.guardAddress, meta.poseTemplate.guardBytes)
          .some((v) => v !== 0xa5) ||
        (animationCache &&
          k.read(cacheOwner + 0x70, 0x100).some((v) => v !== 0xa5)) ||
        k.read(skinOutput + count * 48, 0x100).some((v) => v !== 0xa5)
      )
        throw Error(
          "Original WASM ANM evaluation escaped its pose/cache guard",
        );
      record.samples.push({
        time: sample.time,
        elapsedMilliseconds: performance.now() - started,
        localByteMismatches,
        worldByteMismatches,
        skinByteMismatches,
        skinMatrices3x4Hex: Buffer.from(skinBytes).toString("hex"),
      });
      if (localByteMismatches || worldByteMismatches || skinByteMismatches)
        mismatches.push({
          resource: resource.sourceIndex,
          index,
          localByteMismatches,
          worldByteMismatches,
          skinByteMismatches,
        });
      samples++;
      jointPoses += count;
    }
  }
} catch (error) {
  boundary = {
    kind: error?.name ?? "WasmExecutionError",
    message: error?.message ?? String(error),
    phase,
    instructionRva: Number(e.reg_read_i64(uc.X86_REG_RIP)) - k.base,
    registers: Object.fromEntries(
      [
        "RAX",
        "RBX",
        "RCX",
        "RDX",
        "RSI",
        "RDI",
        "R8",
        "R9",
        "R10",
        "R11",
        "R12",
        "R13",
        "R14",
        "R15",
      ].map((name) => [name, Number(e.reg_read_i64(uc[`X86_REG_${name}`]))]),
    ),
  };
} finally {
  e.close();
}
for (const name of [
  "latest-vfx-spawn.mjs",
  "native-decoder.mjs",
  "structural-comparison.mjs",
])
  await raw(`${import.meta.dir}/../${name}`);
const result = {
  schema: 1,
  kind: "original-native-anm-wasm-comparison",
  build: meta.build,
  inputs,
  sourceSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  additionalMemoryServices: [
    {
      rva: 0x1fee5fa,
      name: "___bzero",
      bounds: "current owned allocation",
      gameResultsSupplied: false,
    },
  ],
  boundary,
  counts: { samples, jointPoses, comparedFloatLanes: jointPoses * 32 },
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 10),
  observations,
  scope: {
    browserCapableWasmEvaluationVerified: !boundary && !mismatches.length,
    originalCompressedAndUncompressedAnm: true,
    originalWorldAndInverseBindPreparation: true,
    staticNativeConstructedPoseTemplate: true,
    recordedAnimationSelection: false,
    animationGraphBlending: false,
    viewerConnected: false,
    mainViewerExpanded: false,
  },
};
const path = `${cache}/research/native-animation-evaluation-wasm-comparison.json`;
await Bun.write(path, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: path,
    counts: result.counts,
    mismatchCount: result.mismatchCount,
    boundary,
  }),
);
if (boundary || mismatches.length) process.exitCode = 1;
