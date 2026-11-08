// Live simultaneous parent workers compared with original native replay probes.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { LatestParentWorkerClient } from "../latest-parent-worker-client.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`,
  inputs = {};
const sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (path) => {
    const b = new Uint8Array(await Bun.file(path).arrayBuffer());
    inputs[path] = sha(b);
    return b;
  },
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path)));
const nativeBytes = await raw(`${cache}/research/parent-missiles-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  scheduleBytes = await raw(`${cache}/research/parent-missile-inputs.json`),
  schedule = JSON.parse(new TextDecoder().decode(scheduleBytes));
if (
  native.kind !== "simultaneous-native-replay-parents" ||
  native.inputSha256 !== sha(scheduleBytes) ||
  native.counts.bursts !== 2 ||
  native.counts.returningBursts !== 2 ||
  native.counts.parents !== 30
)
  throw Error("Incomplete simultaneous native replay parent reference");
for (const [file, digest] of Object.entries(native.sources))
  if (sha(await raw(resolve(import.meta.dir, file))) !== digest)
    throw Error(`Native replay parent producer changed: ${file}`);
for (const [file, digest] of Object.entries(schedule.sources))
  if (sha(await raw(`${root}/${file}`)) !== digest)
    throw Error(`Replay input producer changed: ${file}`);
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
  JSON.parse(new TextDecoder().decode(common.mathPackageBytes)).source
    .sha256 !== native.mathProviderSha256
)
  throw Error("Simultaneous replay parent image/math reference changed");
for (const block of native.originalBlocks)
  if (
    sha(common.image.subarray(block.rva, block.rva + block.size)) !==
    block.sha256
  )
    throw Error("Executed replay parent code changed");
const catalog = JSON.parse(new TextDecoder().decode(common.cachePackageBytes));
const hex = (b) =>
  Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
const geometry = (list) =>
  list.map(({ vertices, indices, draw, ...g }) => ({
    ...g,
    verticesHex: hex(vertices),
    indicesHex: hex(indices),
    drawHex: hex(draw),
  }));
const digestWorld = (data) => {
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
const counts = {
    bursts: 0,
    parents: 0,
    forwardWorldFrames: 0,
    forwardParentUpdates: 0,
    restoredWorldFrames: 0,
    restoredParentUpdates: 0,
    geometryRecords: 0,
    worldContinuations: 0,
  },
  checks = [],
  worlds = [],
  began = performance.now();
for (let bi = 0; bi < schedule.bursts.length; bi++) {
  const burst = schedule.bursts[bi],
    reference = native.cases[bi],
    client = new LatestParentWorkerClient();
  check(
    reference.effectId === burst.effectId &&
      reference.startTime === burst.startTime,
    "Native burst order differs from replay inputs",
  );
  try {
    const ref = catalog.caches.find((v) => v.effectId === burst.effectId);
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
    const handles = new Map();
    for (let i = 0; i < burst.parents.length; i++) {
      const source = burst.parents[i],
        expected = reference.parents[i],
        created = await client.createParent({
          seed: BigInt(source.seed),
          clock: { ...source.clock, ticks: source.clock.ticks.map(BigInt) },
          placement: source.placement,
        });
      const actual = {
        sequence: source.sequence,
        ownership: created.ownership,
        placement: created.placement,
        state: (await client.inspect(created.handle)).state,
      };
      if (!isDeepStrictEqual(actual, expected)) {
        await Bun.write(
          `${cache}/research/parent-missiles-initial-difference.json`,
          JSON.stringify({ burst: bi, actual, expected }, null, 2),
        );
        throw Error(
          `Concurrent replay parent factory differs: ${source.sequence}`,
        );
      }
      handles.set(source.sequence, created.handle);
      counts.parents++;
    }
    let checkpoint;
    for (let fi = 0; fi < burst.frames.length; fi++) {
      const source = burst.frames[fi],
        expected = reference.frames[fi];
      const packet = await client.frame(
        source.updates.map(({ sequence, ...u }) => ({
          ...u,
          handle: handles.get(sequence),
        })),
        schedule.camera,
        { captureState: true },
      );
      check(
        isDeepStrictEqual(packet.camera, schedule.camera) &&
          packet.parents.length === burst.parents.length &&
          new Set(packet.parents.map((p) => p.id)).size ===
            burst.parents.length,
        "Incomplete simultaneous replay frame",
      );
      const actual = {
        index: fi,
        time: source.time,
        parents: packet.parents.map(({ id, ...p }, i) => ({
          sequence: source.updates[i].sequence,
          ...p,
          geometry: geometry(p.geometry),
        })),
      };
      if (!isDeepStrictEqual(actual, expected)) {
        await Bun.write(
          `${cache}/research/parent-missiles-frame-difference.json`,
          JSON.stringify({ burst: bi, actual, expected }, null, 2),
        );
        throw Error(
          `Concurrent replay parent frame differs: burst ${bi} frame ${fi}`,
        );
      }
      counts.forwardWorldFrames++;
      counts.forwardParentUpdates += packet.parents.length;
      counts.geometryRecords += packet.parents.reduce(
        (n, p) => n + p.geometry.length,
        0,
      );
      checks.push({
        burst: bi,
        frame: fi,
        restored: false,
        stateAndGeometrySha256: sha(
          new TextEncoder().encode(JSON.stringify(actual)),
        ),
      });
      if (fi === 5) checkpoint = await client.checkpoint();
    }
    check(!!checkpoint, "Missing simultaneous replay checkpoint");
    const finalWorld = digestWorld(await client.worldState());
    await client.restore(checkpoint);
    for (let fi = 6; fi < burst.frames.length; fi++) {
      const source = burst.frames[fi],
        referenceFrame = reference.frames[fi];
      const packet = await client.frame(
        source.updates.map(({ sequence, ...u }) => ({
          ...u,
          handle: handles.get(sequence),
        })),
        schedule.camera,
      );
      const actual = packet.parents.map(({ id, ...p }, i) => ({
        sequence: source.updates[i].sequence,
        ...p,
        geometry: geometry(p.geometry),
      }));
      const expected = referenceFrame.parents.map(({ state, ...p }) => ({
        ...p,
        placement: {
          setters: { setters: p.placement.setters.setters },
          sync: {},
        },
      }));
      check(
        isDeepStrictEqual(actual, expected),
        `Restored concurrent replay frame differs: burst ${bi} frame ${fi}`,
      );
      counts.restoredWorldFrames++;
      counts.restoredParentUpdates += packet.parents.length;
      counts.geometryRecords += packet.parents.reduce(
        (n, p) => n + p.geometry.length,
        0,
      );
      checks.push({
        burst: bi,
        frame: fi,
        restored: true,
        geometrySha256: sha(new TextEncoder().encode(JSON.stringify(actual))),
      });
    }
    check(
      digestWorld(await client.worldState()) === finalWorld,
      "Restored simultaneous replay CPU world differs",
    );
    counts.worldContinuations++;
    worlds.push({ burst: bi, finalWorldSha256: finalWorld });
    await client.releaseCheckpoint(checkpoint);
    counts.bursts++;
    console.log(
      JSON.stringify({
        burst: bi,
        parents: handles.size,
        worldFrames: burst.frames.length,
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
  "latest-missile-playback.mjs",
  "latest-parent-missile-inputs.mjs",
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
  "tools/inspect-parent-missiles.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "simultaneous-replay-parent-native-wasm-comparison",
  observationSha256: sha(nativeBytes),
  inputSha256: sha(scheduleBytes),
  inputs,
  sources,
  policy: schedule.policy,
  counts,
  checks,
  worlds,
  mismatchCount: 0,
  elapsedMs: performance.now() - began,
  scope: {
    realBunModuleWorkers: true,
    decodedMissileInputs: true,
    simultaneousParents: true,
    allUpdatesBeforeGeometry: true,
    callerOrderedSharedRng: true,
    independentBurstContexts: true,
    originalEffectEventMapping: false,
    originalSeedAndJobOrdering: false,
    browserExecuted: false,
    mainViewerIntegrated: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/parent-missiles-wasm.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
