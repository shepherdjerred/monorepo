// Compare original resource/clock/parent code in WASM against native execution.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual as equal } from "node:util";
import { createLatestVfxObjects } from "../latest-vfx-objects.mjs";
import { VFX_RESOURCE_CONTEXT_SHA } from "../latest-vfx-resource-context.mjs";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: inspect-vfx-resource-context.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  hex = (b) => Buffer.from(b).toString("hex"),
  native = await read(`${cache}/research/vfx-resource-context-native.json`),
  profile = await read(`${decoder}/profile.json`),
  image = await raw(`${decoder}/image.bin`),
  resourceBytes = await raw(
    `${assets}/latest-vfx-resource-context/package.json`,
  ),
  packageBytes = await raw(`${assets}/latest-vfx-objects/package.json`),
  systemsPackageBytes = await raw(
    `${assets}/latest-vfx-system-assets/package.json`,
  ),
  effectsBytes = await raw(`${assets}/latest-effects/manifest.json`),
  nativeAssetBytes = await raw(`${decoder}/vfx-assets.json`),
  spawnBytes = await raw(`${decoder}/vfx-spawn.json`),
  systems = JSON.parse(new TextDecoder().decode(systemsPackageBytes)),
  effects = JSON.parse(new TextDecoder().decode(effectsBytes));
check(
  sha(resourceBytes) === VFX_RESOURCE_CONTEXT_SHA &&
    native.packageSha256 === VFX_RESOURCE_CONTEXT_SHA,
  "Native resource package differs",
);
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    `Resource native source changed: ${name}`,
  );
for (const [path, h] of Object.entries(native.inputs))
  check(sha(await raw(path)) === h, `Resource native input changed: ${path}`);
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original resource instruction block changed",
  );
const vendor = `${assets}/vendor/unicorn_x86_candidate.mjs`;
check(
  sha(await raw(vendor)) ===
    "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
  "Native resource WASM runtime differs",
);
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn(),
  runtime = await createLatestVfxObjects({
    uc,
    profile,
    image,
    packageBytes,
    systemsPackageBytes,
    effectsBytes,
    nativeAssetBytes,
    spawnBytes,
  }),
  graphs = new Map(),
  counts = {
    activations: 0,
    contextChecks: 0,
    parentBytes: 0,
    clockChecks: 0,
    authoredChecks: 0,
    rejections: 0,
    boundaryChecks: 0,
  };
let previous = null;
async function load(name) {
  if (!graphs.has(name))
    graphs.set(name, {
      effectBytes: await raw(
        `${assets}/latest-effects/${effects.definitions[name].file}`,
      ),
      graphBytes: await raw(
        `${assets}/latest-vfx-system-assets/${systems.systems[name].file}`,
      ),
    });
  const bytes = graphs.get(name);
  await runtime.loadSystem(name, bytes.effectBytes, bytes.graphBytes, {
    quality: 0,
    graphics34b: false,
    sceneInput: 0,
    resourcePackageBytes: resourceBytes,
  });
  return JSON.parse(new TextDecoder().decode(bytes.graphBytes));
}
function reject(fn, word) {
  let rejected = false;
  try {
    fn();
  } catch (error) {
    check(
      error.message.includes(word),
      `Unexpected rejection: ${error.message}`,
    );
    rejected = true;
  }
  check(rejected, `Invalid resource operation accepted: ${word}`);
  counts.rejections++;
}
try {
  for (const [index, c] of native.cases.entries()) {
    const graph = await load(c.effectId);
    if (previous) reject(() => runtime.bytes(previous), "stale");
    const initialized = await runtime.initializeResourceContext(resourceBytes);
    check(
      equal(initialized, c.initialContext),
      `Native resource initialization differs: ${index}`,
    );
    counts.contextChecks++;
    const clock = runtime.setClockInputs({
        ticks: c.input.ticks.map(BigInt),
        mode: c.input.mode,
        timebase: c.input.timebase,
      }),
      expectedClock = {
        context: c.clock.context,
        ticks: c.clock.ticks.map(BigInt),
        selectorMode: c.clock.selectorMode,
        timebase: c.clock.timebase,
        nativeFrequency: BigInt(c.clock.nativeFrequency),
        tickScale: c.clock.tickScale,
      };
    check(
      equal(clock, expectedClock),
      `Original clock initialization differs: ${index} ${JSON.stringify({ clock, expectedClock }, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
    );
    counts.clockChecks++;
    const handle = runtime.create();
    runtime.setScalars(handle, c.input.firstBits, c.input.secondBits);
    runtime.markReady(handle);
    check(
      handle.address === c.object &&
        hex(runtime.bytes(handle)) === c.initialObjectHex,
      "Initial native object bytes differ",
    );
    const activation = runtime.activate(handle),
      state = runtime.state(),
      context = runtime.resourceContextState(),
      authored = runtime.authoredBytes();
    if (
      hex(activation.parentBytes) !== c.parentHex ||
      hex(runtime.bytes(handle)) !== c.objectHex
    )
      console.log(
        JSON.stringify({
          case: index,
          parent: activation.parent,
          expectedParent: c.parent,
          parentDifferences: [...activation.parentBytes]
            .flatMap((v, i) =>
              v !== Buffer.from(c.parentHex, "hex")[i]
                ? [[i, Buffer.from(c.parentHex, "hex")[i], v]]
                : [],
            )
            .slice(0, 30),
          objectDifferences: [...runtime.bytes(handle)]
            .flatMap((v, i) =>
              v !== Buffer.from(c.objectHex, "hex")[i]
                ? [[i, Buffer.from(c.objectHex, "hex")[i], v]]
                : [],
            )
            .slice(0, 30),
        }),
      );
    check(
      activation.parent === c.parent &&
        hex(activation.parentBytes) === c.parentHex &&
        activation.activeParentCount === c.activeParentCount &&
        hex(runtime.bytes(handle)) === c.objectHex,
      `Original parent activation differs: ${index}`,
    );
    counts.parentBytes += activation.parentBytes.length;
    check(
      state.managerHex === c.managerHex && equal(context, c.resourceContext),
      `Post-activation manager differs: ${index}`,
    );
    counts.contextChecks++;
    check(
      hex(authored.object) === c.rootAfterHex &&
        hex(authored.heap) === graph.heapHex,
      "Original observer vector or authored heap differs",
    );
    counts.authoredChecks++;
    if (index === 0) {
      reject(() => runtime.activate(handle), "one-shot");
      reject(
        () =>
          runtime.setClockInputs({
            ticks: [1n, 2n, 3n],
            mode: 0,
            timebase: [2, 1],
          }),
        "timebase cannot change",
      );
      reject(
        () =>
          runtime.setClockInputs({
            ticks: [1n, 2n, 3n],
            mode: 3,
            timebase: [1, 1],
          }),
        "Three explicit",
      );
      reject(
        () =>
          runtime.setClockInputs({
            ticks: [-1n, 2n, 3n],
            mode: 0,
            timebase: [1, 1],
          }),
        "Three explicit",
      );
    }
    previous = handle;
    counts.activations++;
  }
  await load(native.boundary.effectId);
  await runtime.initializeResourceContext(resourceBytes);
  const handle = runtime.create();
  runtime.setScalars(handle, 0x3f800000, 0x3f800000);
  runtime.markReady(handle);
  reject(() => runtime.activate(handle), "clock inputs required");
  runtime.setClockInputs({ ticks: [0n, 0n, 0n], mode: 0, timebase: [1, 1] });
  let boundary = false;
  try {
    runtime.activate(handle);
  } catch (error) {
    check(
      error.message.includes(`RVA 0x${native.boundary.rva.toString(16)}`),
      `Resource boundary differs: ${error.message}`,
    );
    boundary = true;
  }
  check(
    boundary,
    "Populated effect silently passed an absent graphics provider",
  );
  counts.boundaryChecks++;
  reject(() => runtime.resourceContextState(), "unfailed");
  const bad = resourceBytes.slice();
  bad[0] ^= 1;
  await load(native.cases[0].effectId);
  let badRejected = false;
  try {
    await runtime.initializeResourceContext(bad);
  } catch (error) {
    badRejected = error.message.includes("Changed resource context");
  }
  check(badRejected, "Changed resource package accepted");
  counts.rejections++;
} finally {
  runtime.close();
}
const build = await Bun.build({
  entrypoints: [`${root}/latest-vfx-objects.mjs`],
  target: "browser",
  write: false,
});
check(build.success, "Native resource browser build failed");
const sources = {};
for (const name of [
  "latest-vfx-resource-context.mjs",
  "latest-vfx-objects.mjs",
  "latest-vfx-spawn.mjs",
  "tools/inspect-vfx-resource-context.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "native-wasm-vfx-resource-context-comparison",
  packageSha256: VFX_RESOURCE_CONTEXT_SHA,
  inputs,
  sources,
  counts,
  scope: {
    nativeWasmStateCompared: true,
    clockInputsSupplied: true,
    authoredFieldsPreserved: true,
    nativeObserverVectorCompared: true,
    fullMaterialCacheConstructor: true,
    textureManagerPrefix: true,
    graphicsProvider: false,
    populatedEffectGraphicsBoundaryUnresolved: true,
    browserBuildPassed: true,
    browserRun: false,
    mainViewerIntegrated: false,
  },
};
await Bun.write(
  `${cache}/research/vfx-resource-context-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(counts));
