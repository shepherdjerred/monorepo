// Compare original moving-parent native frames with live WASM worker execution.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { LatestParentWorkerClient } from "../latest-parent-worker-client.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  effect = process.argv[3],
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`;
const sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  inputs = {};
const raw = async (p) => {
  const b = new Uint8Array(await Bun.file(p).arrayBuffer());
  inputs[p] = sha(b);
  return b;
};
const read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
const nativeBytes = await raw(
    `${cache}/research/parent-placement-native${effect ? "-partial" : ""}.json`,
  ),
  native = JSON.parse(new TextDecoder().decode(nativeBytes));
if (
  native.kind !== "original-parent-placement-frames" ||
  native.counts.returningRoots !== native.counts.roots ||
  !native.scope.originalProviderFreeObjectSync ||
  native.scope.replayFieldMapping ||
  native.scope.entityBoneProviders ||
  native.scope.browserRun
)
  throw Error("Incomplete or overstated native placement reference");
for (const [name, digest] of Object.entries(native.sources))
  if (sha(await raw(resolve(import.meta.dir, name))) !== digest)
    throw Error(`Native placement producer changed: ${name}`);
const bulkPackageBytes = await raw(
    `${assets}/latest-unicorn-bulk/package.json`,
  ),
  bulk = JSON.parse(new TextDecoder().decode(bulkPackageBytes));
const common = {
  profile: await read(`${decoder}/profile.json`),
  image: await raw(`${decoder}/image.bin`),
  spawnBytes: await raw(`${decoder}/vfx-spawn.json`),
  abiBytes: await raw(`${assets}/latest-parent-frame-runtime/package.json`),
  cachePackageBytes: await raw(
    `${assets}/latest-parent-frame-caches/package.json`,
  ),
  mathPackageBytes: await raw(`${assets}/latest-parent-math/package.json`),
  runtimeBytes: await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
  bulkPackageBytes,
  bulkWasmBytes: await raw(`${assets}/latest-unicorn-bulk/${bulk.file}`),
};
if (
  sha(common.image) !== native.decoderImageSha256 ||
  common.profile.clientVersion !== native.build ||
  common.profile.protocolDigest !== native.protocol
)
  throw Error("Native placement image/build mismatch");
for (const block of native.originalBlocks)
  if (
    sha(common.image.subarray(block.rva, block.rva + block.size)) !==
    block.sha256
  )
    throw Error("Native placement executed instruction bytes changed");
const catalog = JSON.parse(new TextDecoder().decode(common.cachePackageBytes)),
  cases = effect
    ? native.cases.filter((c) => c.effectId === effect)
    : native.cases;
if (!cases.length) throw Error("Unknown placement effect");
if (
  JSON.parse(new TextDecoder().decode(common.mathPackageBytes)).source
    .sha256 !== native.mathProviderSha256
)
  throw Error(
    "Native placement math provider differs from prepared WASM kernels",
  );
const hex = (b) =>
  Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
const geometry = (list) =>
  list.map(({ vertices, indices, draw, ...g }) => ({
    ...g,
    verticesHex: hex(vertices),
    indicesHex: hex(indices),
    drawHex: hex(draw),
  }));
const worldDigest = (data) => {
  const h = new Bun.CryptoHasher("sha256");
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
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const checks = [],
  worlds = [],
  counts = {
    roots: cases.length,
    forwardFrames: 0,
    restoredFrames: 0,
    geometryRecords: 0,
    worldContinuations: 0,
    initialPlacementComparisons: 0,
  },
  began = performance.now();
for (const c of cases) {
  const client = new LatestParentWorkerClient();
  try {
    const ref = catalog.caches.find((v) => v.effectId === c.effectId);
    await client.initialize({
      assetBase: "http://127.0.0.1:4180/assets/",
      runtimeModuleUrl: pathToFileURL(
        `${assets}/vendor/unicorn_x86_candidate.mjs`,
      ).href,
      options: {
        ...common,
        image: common.image.slice(),
        cacheBytes: await raw(
          `${assets}/latest-parent-frame-caches/${ref.file}`,
        ),
      },
      transferImage: true,
    });
    const { handle, ownership, placement } = await client.createParent({
      seed: 9876n,
      clock: {
        ticks: [2000000000n, 2000000000n, 2000000000n],
        mode: 0,
        timebase: [1, 1],
      },
      placement: c.initialPose,
    });
    const initial = {
        ownership,
        placement,
        state: (await client.inspect(handle)).state,
      },
      expectedInitial = {
        ownership: c.ownership,
        placement: { setters: c.initialSetters, sync: c.initialSync },
        state: c.initialState,
      };
    if (!isDeepStrictEqual(initial, expectedInitial)) {
      await Bun.write(
        `${cache}/research/parent-placement-initial-difference.json`,
        JSON.stringify(
          { effectId: c.effectId, actual: initial, expected: expectedInitial },
          null,
          2,
        ),
      );
      throw Error(
        `Native/WASM placed parent initial state differs: ${c.effectId}`,
      );
    }
    counts.initialPlacementComparisons++;
    let checkpoint;
    for (const f of c.frames) {
      const packet = await client.frame(
        [{ handle, time: f.time, maxSubsteps: 20, placement: f.placement }],
        native.camera,
        { captureState: true },
      );
      check(
        isDeepStrictEqual(packet.camera, native.camera) &&
          packet.parents.length === 1,
        "Placed frame changed its camera/parent ownership",
      );
      const { id, ...actual } = packet.parents[0];
      actual.geometry = geometry(actual.geometry);
      const expected = {
        ...Object.fromEntries(
          ["time", "substeps", "state", "geometry"].map((k) => [k, f[k]]),
        ),
        placement: { setters: f.setters, sync: f.sync },
      };
      if (!isDeepStrictEqual(actual, expected)) {
        await Bun.write(
          `${cache}/research/parent-placement-frame-difference.json`,
          JSON.stringify(
            { effectId: c.effectId, tick: f.tick, actual, expected },
            null,
            2,
          ),
        );
        throw Error(
          `Native/WASM placed parent frame differs: ${c.effectId} ${f.tick}`,
        );
      }
      counts.forwardFrames++;
      counts.geometryRecords += actual.geometry.length;
      checks.push({
        effectId: c.effectId,
        tick: f.tick,
        restored: false,
        nativeStateAndGeometrySha256: f.stateAndGeometrySha256,
      });
      if (f.tick === 12) checkpoint = await client.checkpoint();
    }
    if (checkpoint && c.frames.length > 12) {
      const finalWorld = worldDigest(await client.worldState());
      await client.restore(checkpoint);
      for (const f of c.frames.slice(12)) {
        const packet = await client.frame(
          [{ handle, time: f.time, maxSubsteps: 20, placement: f.placement }],
          native.camera,
        );
        const { id, ...actual } = packet.parents[0];
        actual.geometry = geometry(actual.geometry);
        const expected = {
          ...Object.fromEntries(
            ["time", "substeps", "geometry"].map((k) => [k, f[k]]),
          ),
          placement: { setters: { setters: f.setters.setters }, sync: {} },
        };
        check(
          isDeepStrictEqual(actual, expected),
          `Restored placed parent geometry differs: ${c.effectId} ${f.tick}`,
        );
        counts.restoredFrames++;
        counts.geometryRecords += actual.geometry.length;
        checks.push({
          effectId: c.effectId,
          tick: f.tick,
          restored: true,
          nativeStateAndGeometrySha256: f.stateAndGeometrySha256,
        });
      }
      check(
        worldDigest(await client.worldState()) === finalWorld,
        "Placed parent checkpoint changed complete CPU world",
      );
      counts.worldContinuations++;
      worlds.push({ effectId: c.effectId, finalWorldSha256: finalWorld });
      await client.releaseCheckpoint(checkpoint);
    }
    console.log(
      JSON.stringify({
        effectId: c.effectId,
        frames: c.frames.length,
        elapsedMs: performance.now() - began,
      }),
    );
  } finally {
    client.close();
    await client.termination;
  }
}
const sources = {};
for (const name of [
  "latest-parent-missile-timeline.mjs",
  "latest-parent-missile-inputs.mjs",
  "latest-missile-playback.mjs",
  "latest-parent-placement.mjs",
  "latest-parent-frames.mjs",
  "latest-parent-worker.mjs",
  "latest-parent-worker-client.mjs",
  "latest-particle-worker-client.mjs",
  "latest-parent-math.mjs",
  "latest-math-isa.mjs",
  "latest-fused-math.mjs",
  "latest-unicorn-bulk.mjs",
  "native-decoder.mjs",
  "latest-vfx-spawn.mjs",
  "structural-comparison.mjs",
  "tools/inspect-parent-placement.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "original-parent-placement-native-wasm-worker-comparison",
  observationSha256: sha(nativeBytes),
  inputs,
  sources,
  counts,
  checks,
  worlds,
  mismatchCount: 0,
  elapsedMs: performance.now() - began,
  scope: {
    realBunModuleWorkers: true,
    originalSettersAndProviderFreeSync: true,
    initialPlacementBeforeParentActivation: true,
    normalCaptureDisabledOnRestore: true,
    suppliedMovingInputs: true,
    entityBoneProviders: false,
    replayFieldMapping: false,
    browserExecuted: false,
    mainViewerIntegrated: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/parent-placement-wasm${effect ? "-partial" : ""}.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
