// Component observations in the browser-targeted WASM executor; no browser UI.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLatestVfxObjects,
  VFX_OBJECTS_PACKAGE_SHA,
} from "../latest-vfx-objects.mjs";

const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: inspect-vfx-objects.mjs <cache>");
const cache = resolve(cacheArg),
  root = resolve(import.meta.dir, ".."),
  decoder = `${cache}/public/decoder-16.21-macos`,
  inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  raw = async (path) => {
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    inputs[path] = sha(bytes);
    return bytes;
  },
  json = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  hex = (bytes) => Buffer.from(bytes).toString("hex"),
  requireThat = (value, message) => {
    if (!value) throw Error(message);
  };
const nativePath = `${cache}/research/vfx-objects-native.json`,
  native = await json(nativePath),
  profile = await json(`${decoder}/profile.json`),
  image = await raw(`${decoder}/image.bin`),
  packageBytes = await raw(`${cache}/public/latest-vfx-objects/package.json`),
  systemsPackageBytes = await raw(
    `${cache}/public/latest-vfx-system-assets/package.json`,
  ),
  effectsBytes = await raw(`${cache}/public/latest-effects/manifest.json`),
  nativeAssetBytes = await raw(`${decoder}/vfx-assets.json`),
  spawnBytes = await raw(`${decoder}/vfx-spawn.json`),
  systems = JSON.parse(new TextDecoder().decode(systemsPackageBytes)),
  effects = JSON.parse(new TextDecoder().decode(effectsBytes)),
  vendor = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
requireThat(
  native.packageSha256 === sha(packageBytes) &&
    sha(packageBytes) === VFX_OBJECTS_PACKAGE_SHA &&
    sha(await raw(vendor)) ===
      "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
  "Native object package/runtime changed",
);
for (const [name, expected] of Object.entries(native.sources))
  requireThat(
    sha(await raw(`${root}/tools/${name}`)) === expected,
    `Native object source changed: ${name}`,
  );
for (const [path, expected] of Object.entries(native.inputs))
  requireThat(
    sha(await raw(path)) === expected,
    `Native object input changed: ${path}`,
  );
for (const block of native.originalBlocks)
  requireThat(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    `Original object execution changed: ${block.rva.toString(16)}`,
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
  sources = {},
  rows = [],
  counts = {
    ...native.counts,
    stageMismatches: 0,
    stateMismatches: 0,
    authoredMutations: 0,
    qualityChecks: 0,
    staleHandleChecks: 0,
  };
let previous = null;
try {
  for (const c of native.cases) {
    const ref = systems.systems[c.effectId],
      effectRef = effects.definitions[c.effectId];
    if (!graphs.has(c.effectId))
      graphs.set(c.effectId, {
        effectBytes: await raw(
          `${cache}/public/latest-effects/${effectRef.file}`,
        ),
        graphBytes: await raw(
          `${cache}/public/latest-vfx-system-assets/${ref.file}`,
        ),
      });
    const { effectBytes, graphBytes } = graphs.get(c.effectId),
      graph = JSON.parse(new TextDecoder().decode(graphBytes));
    requireThat(
      sha(graphBytes) === c.graphSha256 && c.graphSha256 === ref.sha256,
      "Object root graph identity changed",
    );
    await runtime.loadSystem(c.effectId, effectBytes, graphBytes, {
      quality: 0,
      graphics34b: false,
      sceneInput: 0,
    });
    if (previous) {
      let rejected = false;
      try {
        runtime.bytes(previous);
      } catch (error) {
        rejected = error.message.includes("stale");
      }
      requireThat(rejected, "Previous world object handle survived reset");
      counts.staleHandleChecks++;
    }
    const observations = [];
    for (const expected of c.observations) {
      const object = runtime.create(),
        initialHex = hex(runtime.bytes(object));
      runtime.setScalars(object, c.firstBits, c.secondBits);
      const configuredHex = hex(runtime.bytes(object));
      runtime.markReady(object);
      const readyHex = hex(runtime.bytes(object));
      const observed = {
        address: object.address,
        initialHex,
        configuredHex,
        readyHex,
      };
      requireThat(
        JSON.stringify(observed) === JSON.stringify(expected),
        `Original object stages differ: case=${c.case}, object=${observations.length}, address=${object.address.toString(16)}`,
      );
      observations.push(observed);
      previous = object;
    }
    const state = runtime.state(),
      authored = runtime.authoredBytes();
    requireThat(
      JSON.stringify(state) === JSON.stringify(c.state),
      `Original manager/queue differs: ${c.case}`,
    );
    requireThat(
      hex(authored.object) === graph.objectHex &&
        hex(authored.heap) === graph.heapHex,
      `Object operations mutated authored root: ${c.case}`,
    );
    const manager = Buffer.from(state.managerHex, "hex"),
      view = new DataView(
        manager.buffer,
        manager.byteOffset,
        manager.byteLength,
      ),
      multipliers = Array.from({ length: 6 }, (_, i) =>
        view.getFloat32(0x284 + i * 4, true),
      );
    requireThat(
      JSON.stringify(multipliers) ===
        JSON.stringify(native.qualityMultipliers) &&
        multipliers.every((n) => n === 1),
      "Original pattern fill multipliers differ",
    );
    counts.qualityChecks++;
    rows.push({
      case: c.case,
      effectId: c.effectId,
      kind: c.kind,
      sourceSequence: c.sourceSequence,
      graphSha256: c.graphSha256,
      firstBits: c.firstBits,
      secondBits: c.secondBits,
      objects: c.objects,
      pendingCount: state.queue.length,
      pendingCapacity: state.capacity,
      readyFlags: observations.map((o) =>
        Buffer.from(o.readyHex, "hex").readUInt32LE(0x18),
      ),
      observationSha256: sha(
        new TextEncoder().encode(JSON.stringify(observations)),
      ),
      stateSha256: sha(new TextEncoder().encode(JSON.stringify(state))),
    });
    if (c.case % 400 === 0)
      console.log(
        JSON.stringify({ cases: c.case + 1, total: native.cases.length }),
      );
  }
} finally {
  runtime.close();
}
requireThat(
  rows.length === native.counts.cases &&
    new Set(
      rows.filter((r) => r.kind === "prepared-root").map((r) => r.effectId),
    ).size === 876 &&
    rows.filter((r) => r.kind === "recorded-scalar-inputs").length === 1107 &&
    rows.reduce((sum, r) => sum + r.objects, 0) === 2000,
  "Incomplete original object corpus",
);
for (const name of [
  "latest-vfx-objects.mjs",
  "latest-vfx-system-assets.mjs",
  "latest-vfx-assets.mjs",
  "latest-vfx-spawn.mjs",
  "native-decoder.mjs",
  "structural-comparison.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const evidence = {
  schema: 1,
  kind: "native-wasm-vfx-object-comparison",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  packageSha256: sha(packageBytes),
  nativeEvidenceSha256: inputs[nativePath],
  inspectorSha256: sha(await raw(import.meta.path)),
  sources,
  inputs,
  counts,
  rows,
  mismatches: [],
  qualityMultipliers: native.qualityMultipliers,
  scope: {
    ...native.scope,
    wasmObjectFactoryExecuted: true,
    completeAuthoredRoots: true,
    originalScalarSettersExecuted: true,
    originalReadySetterExecuted: true,
    browserRun: false,
    leagueReferenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/vfx-objects-comparison.json`,
  JSON.stringify(evidence, null, 2),
);
console.log(
  JSON.stringify({
    counts,
    qualityMultipliers: native.qualityMultipliers,
    scope: evidence.scope,
  }),
);
