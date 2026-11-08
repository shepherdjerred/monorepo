// Execute original complete-parent functions in WASM and compare native evidence.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createLatestParentFrames } from "../latest-parent-frames.mjs";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";
const args = process.argv.slice(2),
  cacheArg = args.shift();
if (!cacheArg)
  throw Error(
    "Usage: inspect-parent-wasm.mjs <cache> [--effect <id>] [--frames <count>]",
  );
let effect,
  frames = 60;
while (args.length) {
  const key = args.shift(),
    value = args.shift();
  if (key === "--effect") effect = value;
  else if (key === "--frames") frames = Number(value);
  else throw Error("Unknown parent inspector argument");
}
if (!Number.isInteger(frames) || frames < 1 || frames > 60)
  throw Error("Parent comparison requires 1..60 frames");
const cache = resolve(cacheArg),
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
  nativeBytes = await raw(`${cache}/research/parent-frames-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  proof = await read(`${cache}/research/parent-frames-inspection.json`),
  profile = await read(`${decoder}/profile.json`),
  image = await raw(`${decoder}/image.bin`),
  spawnBytes = await raw(`${decoder}/vfx-spawn.json`),
  abiBytes = await raw(`${assets}/latest-parent-frame-runtime/package.json`),
  mathPackageBytes = await raw(`${assets}/latest-parent-math/package.json`),
  cachePackageBytes = await raw(
    `${assets}/latest-parent-frame-caches/package.json`,
  ),
  catalog = JSON.parse(new TextDecoder().decode(cachePackageBytes)),
  runtimeBytes = await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
  bulkBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
  bulk = JSON.parse(new TextDecoder().decode(bulkBytes)),
  wasmBytes = await raw(`${assets}/latest-unicorn-bulk/${bulk.file}`),
  { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = await createLatestBulkUnicorn(
    factory,
    runtimeBytes,
    bulkBytes,
    wasmBytes,
  );
if (
  proof.observationSha256 !== sha(nativeBytes) ||
  proof.mismatchCount ||
  native.counts.roots !== 10
)
  throw Error("Parent native reference differs");
for (const [name, digest] of Object.entries(native.sources))
  if (sha(await raw(resolve(import.meta.dir, name))) !== digest)
    throw Error(`Native parent producer changed: ${name}`);
const cases = effect
  ? native.cases.filter((c) => c.effectId === effect)
  : native.cases;
if (!cases.length)
  throw Error("Requested parent is absent from inspected cohort");
const checks = [],
  timings = [],
  seekChecks = [],
  worldChecks = [],
  rejections = [],
  began = performance.now();
const digestWorld = (runtime) => {
  const data = runtime.worldState(),
    h = new Bun.CryptoHasher("sha256");
  for (const [address, bytes] of data.memory) {
    const header = new Uint8Array(16),
      v = new DataView(header.buffer);
    v.setBigUint64(0, BigInt(address), true);
    v.setBigUint64(8, BigInt(bytes.length), true);
    h.update(header);
    h.update(bytes);
  }
  return h.update(JSON.stringify(data.host)).digest("hex");
};
function reject(effectId, kind, fn) {
  let failure;
  try {
    fn();
  } catch (error) {
    failure = error;
  }
  if (!failure) throw Error(`Parent accepted invalid operation: ${kind}`);
  const expected = {
    "future-parent-after-rewind": "Unowned parent handle",
    "forged-parent-handle": "Unowned parent handle",
    "foreign-checkpoint": "Released or unowned parent checkpoint",
    "capture-with-locked-mutex":
      "Parent checkpoint cannot retain a locked mutex",
    "restore-with-locked-mutex":
      "Parent checkpoint cannot retain a locked mutex",
    "capture-during-native-update":
      "Parent checkpoint requires live idle owned parents",
    "restore-during-native-update":
      "Parent checkpoint requires live idle owned parents",
    "released-checkpoint": "Released or unowned parent checkpoint",
    "duplicate-checkpoint-release":
      "Released or unowned parent checkpoint release",
    "capture-after-close": "Closed parent CPU runtime",
    "restore-after-close": "Closed parent CPU runtime",
  }[kind];
  if (!expected || failure.message !== expected)
    throw Error(
      `Invalid parent operation failed at the wrong boundary: ${kind}: ${failure.message}`,
    );
  rejections.push({ effectId, kind, message: String(failure.message) });
}
for (const c of cases) {
  const ref = catalog.caches.find((r) => r.effectId === c.effectId),
    runtime = await createLatestParentFrames({
      uc,
      profile,
      image,
      spawnBytes,
      abiBytes,
      mathPackageBytes,
      loadMathBytes: (name) => raw(`${assets}/latest-parent-math/${name}`),
      cachePackageBytes,
      cacheBytes: await raw(`${assets}/latest-parent-frame-caches/${ref.file}`),
      loadBytes: (name) => raw(`${assets}/latest-parent-frame-caches/${name}`),
    });
  try {
    let checkpoint, checkpointWorld;
    const handle = runtime.createParent({
      seed: 9876n,
      clock: {
        ticks: [2000000000n, 2000000000n, 2000000000n],
        mode: 0,
        timebase: [1, 1],
      },
    });
    const ownership = runtime.ownership(handle),
      state = runtime.state(handle);
    if (!isDeepStrictEqual(ownership, c.ownership))
      throw Error(
        `Parent factory ownership differs: ${c.effectId}\n${JSON.stringify({ actual: ownership, expected: c.ownership })}`,
      );
    if (!isDeepStrictEqual(state, c.initialState)) {
      await Bun.write(
        `${cache}/research/parent-wasm-initial-difference.json`,
        JSON.stringify(
          { effectId: c.effectId, actual: state, expected: c.initialState },
          null,
          2,
        ),
      );
      throw Error(`Parent factory initial state differs: ${c.effectId}`);
    }
    for (const expected of c.frames.slice(0, frames)) {
      const transition = c.suspension.find(
        (v) => v.beforeTick === expected.tick,
      );
      if (transition) {
        const actual = runtime.suspend(handle, transition.suspended),
          { beforeTick: _, ...reference } = transition;
        if (!isDeepStrictEqual(actual, reference))
          throw Error("Parent suspension differs");
      }
      const started = performance.now();
      const actual = runtime.advance(handle, expected.time, 20);
      const advanced = performance.now();
      actual.geometry = runtime.render(handle, native.camera);
      timings.push({
        effectId: c.effectId,
        tick: expected.tick,
        advanceMs: advanced - started,
        renderMs: performance.now() - advanced,
      });
      const reference = Object.fromEntries(
        ["time", "substeps", "state", "geometry"].map((name) => [
          name,
          expected[name],
        ]),
      );
      if (!isDeepStrictEqual(actual, reference)) {
        await Bun.write(
          `${cache}/research/parent-wasm-frame-difference.json`,
          JSON.stringify(
            {
              effectId: c.effectId,
              tick: expected.tick,
              actual,
              expected: reference,
              mathCalls: runtime.kernel.mathCalls,
            },
            null,
            2,
          ),
        );
        throw Error(
          `Parent native/WASM frame differs: ${c.effectId} tick ${expected.tick}`,
        );
      }
      checks.push({
        effectId: c.effectId,
        tick: expected.tick,
        stateAndGeometrySha256: expected.stateAndGeometrySha256,
        geometryRecords: actual.geometry.length,
      });
      if (expected.tick === 12) {
        checkpoint = runtime.checkpoint();
        checkpointWorld = digestWorld(runtime);
      }
    }
    if (checkpoint && frames > 12) {
      const finalState = runtime.worldState(),
        finalWorld = digestWorld(runtime),
        finalCheckpoint = runtime.checkpoint();
      const probe = runtime.createParent({
        seed: 7654321n,
        clock: {
          ticks: [3000000000n, 3000000000n, 3000000000n],
          mode: 0,
          timebase: [1, 1],
        },
      });
      const futureWorld = digestWorld(runtime),
        futureCheckpoint = runtime.checkpoint();
      runtime.restore(checkpoint);
      if (digestWorld(runtime) !== checkpointWorld)
        throw Error(
          "Parent checkpoint did not restore its entire declared CPU world",
        );
      reject(c.effectId, "future-parent-after-rewind", () =>
        runtime.state(probe),
      );
      reject(c.effectId, "forged-parent-handle", () =>
        runtime.ownership({ ...handle }),
      );
      reject(c.effectId, "foreign-checkpoint", () =>
        runtime.restore(Object.freeze({})),
      );
      const mutex = [...runtime.kernel.mutexes.values()][0];
      if (!mutex || mutex.depth !== 0)
        throw Error("Missing idle checkpoint mutex");
      mutex.depth = 1;
      try {
        reject(c.effectId, "capture-with-locked-mutex", () =>
          runtime.checkpoint(),
        );
        reject(c.effectId, "restore-with-locked-mutex", () =>
          runtime.restore(checkpoint),
        );
      } finally {
        mutex.depth = 0;
      }
      let checkedBusy = false;
      const busyHook = runtime.kernel.engine.hook_add(
        uc.HOOK_CODE,
        () => {
          if (checkedBusy) return;
          checkedBusy = true;
          reject(c.effectId, "capture-during-native-update", () =>
            runtime.checkpoint(),
          );
          reject(c.effectId, "restore-during-native-update", () =>
            runtime.restore(checkpoint),
          );
        },
        null,
        profile.imageBase + 0x1763220,
        profile.imageBase + 0x1763220,
      );
      runtime.kernel.engine.ctl_remove_cache(
        BigInt(profile.imageBase + 0x1763220),
        BigInt(profile.imageBase + 0x1763221),
      );
      try {
        for (const expected of c.frames.slice(12, frames)) {
          const transition = c.suspension.find(
            (v) => v.beforeTick === expected.tick,
          );
          if (transition) runtime.suspend(handle, transition.suspended);
          const actual = runtime.advance(handle, expected.time, 20);
          actual.geometry = runtime.render(handle, native.camera);
          const reference = Object.fromEntries(
            ["time", "substeps", "state", "geometry"].map((name) => [
              name,
              expected[name],
            ]),
          );
          if (!isDeepStrictEqual(actual, reference))
            throw Error(
              `Restored parent native/WASM frame differs: ${c.effectId} tick ${expected.tick}`,
            );
          seekChecks.push({
            effectId: c.effectId,
            tick: expected.tick,
            stateAndGeometrySha256: expected.stateAndGeometrySha256,
            geometryRecords: actual.geometry.length,
          });
        }
      } finally {
        runtime.kernel.engine.hook_del(busyHook);
        runtime.kernel.engine.ctl_remove_cache(
          BigInt(profile.imageBase + 0x1763220),
          BigInt(profile.imageBase + 0x1763221),
        );
      }
      if (!checkedBusy)
        throw Error("Checkpoint admission hook was not executed");
      if (digestWorld(runtime) !== finalWorld) {
        const actual = runtime.worldState(),
          differences = [];
        for (let i = 0; i < finalState.memory.length; i++) {
          const [address, a] = actual.memory[i],
            [, b] = finalState.memory[i];
          for (let j = 0; j < Math.max(a.length, b.length); j++)
            if (a[j] !== b[j] && differences.length < 100)
              differences.push({
                address: address + j,
                actual: a[j],
                expected: b[j],
              });
        }
        await Bun.write(
          `${cache}/research/parent-wasm-checkpoint-world-difference.json`,
          JSON.stringify(
            {
              effectId: c.effectId,
              differences,
              actualHost: actual.host,
              expectedHost: finalState.host,
            },
            null,
            2,
          ),
        );
        throw Error(
          "Parent continuation changed the complete declared CPU world",
        );
      }
      runtime.restore(futureCheckpoint);
      runtime.ownership(probe);
      if (digestWorld(runtime) !== futureWorld)
        throw Error(
          "Restoring a future checkpoint omitted a parent or CPU state",
        );
      runtime.restore(finalCheckpoint);
      if (digestWorld(runtime) !== finalWorld)
        throw Error(
          "Repeated checkpoint switching changed the terminal CPU world",
        );
      for (const token of [checkpoint, futureCheckpoint, finalCheckpoint])
        runtime.releaseCheckpoint(token);
      reject(c.effectId, "released-checkpoint", () =>
        runtime.restore(checkpoint),
      );
      reject(c.effectId, "duplicate-checkpoint-release", () =>
        runtime.releaseCheckpoint(checkpoint),
      );
      worldChecks.push({
        effectId: c.effectId,
        checkpointWorldSha256: checkpointWorld,
        finalWorldSha256: finalWorld,
        futureWorldSha256: futureWorld,
      });
    } else if (checkpoint) runtime.releaseCheckpoint(checkpoint);
    console.log(
      JSON.stringify({
        effectId: c.effectId,
        frames,
        geometryRecords: checks
          .filter((r) => r.effectId === c.effectId)
          .reduce((n, r) => n + r.geometryRecords, 0),
        elapsedMs: performance.now() - began,
        frameCpuMs: (() => {
          const samples = timings
            .filter((t) => t.effectId === c.effectId)
            .map((t) => t.advanceMs + t.renderMs);
          return {
            mean: samples.reduce((a, b) => a + b, 0) / samples.length,
            max: Math.max(...samples),
          };
        })(),
      }),
    );
  } finally {
    runtime.close();
    reject(c.effectId, "capture-after-close", () => runtime.checkpoint());
    reject(c.effectId, "restore-after-close", () =>
      runtime.restore(Object.freeze({})),
    );
  }
}
const sourceNames = [
    "latest-parent-frames.mjs",
    "latest-parent-placement.mjs",
    "native-decoder.mjs",
    "latest-vfx-spawn.mjs",
    "latest-vfx-emitter.mjs",
    "latest-parent-math.mjs",
    "latest-math-isa.mjs",
    "latest-fused-math.mjs",
    "latest-unicorn-bulk.mjs",
    "structural-comparison.mjs",
    "tools/inspect-parent-wasm.mjs",
  ],
  sources = {};
for (const name of sourceNames)
  sources[name] = sha(await raw(resolve(import.meta.dir, "..", name)));
const result = {
  schema: 1,
  kind: "complete-parent-native-wasm-comparison",
  observationSha256: sha(nativeBytes),
  inputs,
  sources,
  counts: {
    roots: cases.length,
    frames: checks.length,
    geometryRecords: checks.reduce((n, r) => n + r.geometryRecords, 0),
    checkpointContinuationFrames: seekChecks.length,
    checkpointGeometryRecords: seekChecks.reduce(
      (n, r) => n + r.geometryRecords,
      0,
    ),
    checkpointCpuWorldComparisons: worldChecks.length,
    rejectedInvalidOperations: rejections.length,
  },
  checks,
  timings,
  seekChecks,
  worldChecks,
  rejections,
  mismatchCount: 0,
  scope: {
    originalFreshParentFactory: true,
    originalParentTickAndWriters: true,
    foreignHostCallbacksForbidden: true,
    partialCorpus: true,
    partialInterval: frames !== 60,
    browserExecuted: false,
    mainViewerIntegrated: false,
    referenceCompared: false,
    offlineDiagnosticTimings: true,
    browserFrameRateMeasured: false,
    modeledHostMathRegisterContract: true,
    originalMacosLibmVerified: false,
    wasmCheckpointsCompared: frames > 12,
    checkpointWorldIncludesMathScratch: true,
    foreignGraphicsResourcesRecreated: false,
  },
};
await Bun.write(
  `${cache}/research/parent-frames-wasm${effect || frames !== 60 ? "-partial" : ""}.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts: result.counts, mismatchCount: 0 }));
