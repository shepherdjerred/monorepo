import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestParentFrames } from "../latest-parent-frames.mjs";
import { createLatestWorldDescriptorFactory } from "../latest-world-descriptor-factory.mjs";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";
import { NativeDecoder } from "../native-decoder.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { WORLD_DESCRIPTOR_ABI_SHA } from "../latest-world-descriptor-abi.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const assets = `${cache}/public`;
const inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
let assertions = 0;
const check = (condition, message) => {
  if (!condition) throw Error(message);
  assertions++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const profile = await read(`${assets}/decoder-16.21-macos/profile.json`);
const image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
check(
  (await sha256(image)) === profile.decoderImageSha256,
  "Original parent flag image differs",
);
const descriptorFactoryBytes = await raw(
  `${assets}/latest-world-descriptor-abi/package.json`,
);
check(
  (await sha256(descriptorFactoryBytes)) === WORLD_DESCRIPTOR_ABI_SHA,
  "Pinned factory flag policy required",
);
const descriptorABI = JSON.parse(
  new TextDecoder().decode(descriptorFactoryBytes),
);
const nativePath = `${cache}/research/world-descriptors-native.json`;
const reference = await read(nativePath);
check(
  inputs[nativePath] === descriptorABI.observationSha256,
  "Pinned complete factory observation differs",
);
const runtimeBytes = await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`);
const { default: factory } = await import(
  pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
);
const bulkBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`);
const bulk = JSON.parse(new TextDecoder().decode(bulkBytes));
const uc = await createLatestBulkUnicorn(
  factory,
  runtimeBytes,
  bulkBytes,
  await raw(`${assets}/latest-unicorn-bulk/${bulk.file}`),
);
const common = {
  uc,
  profile,
  image,
  descriptorFactoryBytes,
  worldFactoryBytes: await raw(
    `${assets}/latest-world-effect-abi/package.json`,
  ),
  spawnBytes: await raw(`${assets}/decoder-16.21-macos/vfx-spawn.json`),
  abiBytes: await raw(`${assets}/latest-parent-frame-runtime/package.json`),
  cachePackageBytes: await raw(
    `${assets}/latest-parent-frame-caches/package.json`,
  ),
  mathPackageBytes: await raw(`${assets}/latest-parent-math/package.json`),
  loadMathBytes: (path) => raw(`${assets}/latest-parent-math/${path}`),
  loadBytes: (path) => raw(`${assets}/latest-parent-frame-caches/${path}`),
};
const catalog = JSON.parse(new TextDecoder().decode(common.cachePackageBytes));
const effectsManifestBytes = await raw(
  `${assets}/latest-effects/manifest.json`,
);
const cases = process.argv.includes("--all")
  ? reference.cases
  : reference.cases.filter(
      (sample) =>
        sample.effectId === (process.argv[3] ?? "champions/jinx/2/8ba24e1e"),
    );
check(cases.length > 0, "Unknown original factory flag-control root");
const mappedFlags = (flags) =>
  (flags & 0x10 ? 0 : 0x10) |
  (flags & 0x20 ? 2 : 0) |
  (flags & 0x80 ? 0x20 : 0);
const flagsToRun = [0x10, 0, 0x20, 0x30, 0x80, 0x90, 0xa0, 0xb0];
const results = [];
let frames = 0,
  geometryRecords = 0;
for (const sample of cases) {
  const cacheRef = catalog.caches.find(
    (entry) => entry.effectId === sample.effectId,
  );
  check(cacheRef, "Original flag-control root lacks a static cache");
  const cacheBytes = await raw(
    `${assets}/latest-parent-frame-caches/${cacheRef.file}`,
  );
  let baseline = null;
  for (const flags of flagsToRun) {
    const runtime = await createLatestParentFrames({ ...common, cacheBytes });
    try {
      const world = await createLatestWorldDescriptorFactory({
        runtime,
        effectsManifestBytes,
      });
      const creation = world.create({
        resourceKey: sample.supplied.key,
        position: sample.supplied.position,
        scale: 1,
        rate: 1,
        flags,
        seed: 9876n,
        clock: {
          ...sample.clockInput,
          ticks: sample.clockInput.ticks.map(BigInt),
        },
      });
      const kernel = runtime.kernel;
      const parent = kernel.q(creation.object + 0x28);
      check(
        kernel.readU32(creation.object + 0x60) === mappedFlags(flags),
        "Original object flag mapping differs",
      );
      check(
        kernel.readU32(parent + 0xf8) === mappedFlags(flags),
        "Original parent flag propagation differs",
      );
      const reads = new Map();
      let stage = "idle";
      kernel.engine.hook_add(
        uc.HOOK_MEM_READ,
        (_engine, _type, address, size) => {
          const pc =
            Number(kernel.engine.reg_read_i64(uc.X86_REG_RIP)) - kernel.base;
          const key = `${stage}:${pc.toString(16)}:${Number(address) - parent}:${size}`;
          reads.set(key, (reads.get(key) ?? 0) + 1);
        },
        null,
        parent + 0xf8,
        parent + 0xfb,
      );
      const observed = [];
      for (let tick = 1; tick <= 12; tick++) {
        stage = "advance";
        const frame = runtime.advance(
          creation.parent,
          Math.fround(creation.ownership.initialTime + tick / 60),
          20,
        );
        stage = "geometry";
        const geometry = runtime.render(creation.parent, reference.camera);
        stage = "idle";
        const normalizedParent = Uint8Array.from(
          Buffer.from(frame.state.parentHex, "hex"),
        );
        normalizedParent.fill(0, 0xf8, 0xfc);
        observed.push({
          time: frame.time,
          substeps: frame.substeps,
          actors: frame.state.actors,
          rngHex: frame.state.rngHex,
          parentHexWithoutFlags: Buffer.from(normalizedParent).toString("hex"),
          geometry,
        });
        frames++;
        geometryRecords += geometry.length;
      }
      if (baseline === null) baseline = observed;
      else
        check(
          same(observed, baseline),
          `Parent flags changed ordinary provider-free particle state/geometry: ${sample.effectId}:${flags}`,
        );
      results.push({
        effectId: sample.effectId,
        descriptorFlags: flags,
        objectFlags: mappedFlags(flags),
        parentFlags: mappedFlags(flags),
        frames: observed.length,
        flagReads: [...reads].map(([site, count]) => ({ site, count })),
        stateAndGeometrySha256: await sha256(
          new TextEncoder().encode(JSON.stringify(observed)),
        ),
      });
      console.log(
        JSON.stringify({
          effectId: sample.effectId,
          descriptorFlags: flags,
          frames: observed.length,
          flagReads: reads.size,
        }),
      );
    } finally {
      runtime.close();
    }
  }
}

// Isolated original stop-tail and reset decisions over explicit cold fields.
// No authored root or replay instance is patched to obtain admission.
const plainUc = await factory();
const decoder = new NativeDecoder(plainUc, profile, image, {
  captureWrites: false,
});
const engine = decoder.engine;
const base = profile.imageBase;
const PARENT = 0x100f0000,
  LINK = 0x100f1000,
  ROOT = 0x100f2000,
  MODE = 0x100f3000;
const EMITTER = 0x100f4000,
  VECTOR = 0x100f5000;
const globalMode = base + 0x246dfd0;
const data = (address, kind, value) => {
  const bytes = new Uint8Array(kind === "u16" ? 2 : 4);
  const view = new DataView(bytes.buffer);
  if (kind === "u16") view.setUint16(0, value, true);
  else if (kind === "u32") view.setUint32(0, value, true);
  else view.setFloat32(0, value, true);
  engine.mem_write(address, bytes);
};
let active = false;
engine.hook_add(
  plainUc.HOOK_CODE,
  () => {
    if (active) engine.emu_stop();
  },
  null,
  base + 0x17629f0,
  base + 0x17629f0,
);
function run(start, end, registers) {
  engine.context_restore(decoder.context);
  engine.reg_write_i64(plainUc.X86_REG_RSP, 0x201ff008n);
  for (const [name, value] of Object.entries(registers))
    engine.reg_write_i64(plainUc[`X86_REG_${name}`], BigInt(value));
  active = true;
  try {
    engine.emu_start(base + start, base + end, 0, 1000);
    return Number(engine.reg_read_i64(plainUc.X86_REG_RIP)) - base;
  } finally {
    active = false;
  }
}
const lifecycleControls = [];
try {
  for (const flags of [0, 2, 0x10, 0x12, 0x20, 0x22, 0x30, 0x32]) {
    for (const stopped of [false, true]) {
      engine.mem_write(PARENT, new Uint8Array(0x2c0));
      engine.mem_write(LINK, new Uint8Array(0x100));
      engine.mem_write(ROOT, new Uint8Array(0x160));
      engine.mem_write(MODE, new Uint8Array(0x400));
      decoder.u64(PARENT + 0x1d8, LINK);
      decoder.u64(LINK + 0x38, ROOT);
      decoder.u64(globalMode, MODE);
      data(PARENT + 0xf8, "u32", flags);
      data(PARENT + 0x2a9, "u16", stopped ? 0x200 : 0);
      data(PARENT + 0x140, "f32", 10);
      data(ROOT + 0xcc, "f32", 1.25);
      check(
        run(0x1762932, 0x1762995, { RBX: PARENT }) === 0x1762995,
        "Original stop-tail fragment did not return",
      );
      const actual = new DataView(
        decoder.read(PARENT + 0x140, 4).buffer,
      ).getFloat32(0, true);
      const expected = stopped && flags & 2 ? 10 : 11.25;
      check(
        actual === expected,
        "Original repeated-stop tail extension differs",
      );
      lifecycleControls.push({
        parentFlags: flags,
        alreadyStopped: stopped,
        initialTailClock: 10,
        authoredTail: 1.25,
        resultingTailClock: actual,
      });
    }
    decoder.u64(PARENT + 0x40, VECTOR);
    data(PARENT + 0x48, "u32", 1);
    decoder.u64(VECTOR, EMITTER);
    decoder.u64(EMITTER, PARENT);
    const target = run(0x17629fd, 0x1762a39, { RBX: PARENT, R14: 0 });
    check(
      target === (flags & 2 ? 0x17629f0 : 0x1762a39),
      "Original emitter-reset flag decision differs",
    );
  }
} finally {
  decoder.close();
}
const sources = {};
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../latest-parent-frames.mjs"),
  resolve(import.meta.dir, "../latest-world-descriptor-factory.mjs"),
  resolve(import.meta.dir, "../latest-world-descriptor-abi.mjs"),
  resolve(import.meta.dir, "../latest-parent-placement.mjs"),
  resolve(import.meta.dir, "../latest-unicorn-bulk.mjs"),
])
  sources[path] = await sha256(await Bun.file(path).bytes());
const summary = {
  roots: cases.length,
  factoryVariants: results.length,
  frames,
  geometryRecords,
  lifecycleControls: lifecycleControls.length,
  assertions,
  scope: {
    originalCompleteFactorySuppliedFlags: true,
    sameRootSeedsClocksAndProviderFreeInputs: true,
    ordinaryParticleStateAndGeometryCompared: true,
    originalFlagReadsObserved: true,
    isolatedRepeatedStopAndEmitterResetBranches: true,
    fullStopLifecycleTranslated: false,
    worldVisibilityOrCullingExecuted: false,
    liveWorldRecovered: false,
    browserExecuted: false,
  },
};
await Bun.write(
  `${cache}/research/direct-parent-flags-comparison${process.argv.includes("--all") ? "" : "-partial"}.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-direct-parent-flags-comparison",
      inputs,
      sources,
      results,
      lifecycle: lifecycleControls,
      ...summary,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summary, null, 2));
