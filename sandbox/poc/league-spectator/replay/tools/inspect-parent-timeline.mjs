// Canonical replay frames against native observations; fractional displays and
// backward seeks against an independently controlled complete-parent worker.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { LatestParentWorkerClient } from "../latest-parent-worker-client.mjs";
import { parentMissilePlacement } from "../latest-parent-missile-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {};
const sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const raw = async (p) => {
  const b = new Uint8Array(await Bun.file(p).arrayBuffer());
  inputs[p] = sha(b);
  return b;
};
const read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const equal = (a, b, message) => check(isDeepStrictEqual(a, b), message);
const worldDigest = (world) => {
  const hash = new Bun.CryptoHasher("sha256");
  for (const [address, bytes] of world.memory) {
    const header = new Uint8Array(16),
      view = new DataView(header.buffer);
    view.setBigUint64(0, BigInt(address), true);
    view.setBigUint64(8, BigInt(bytes.length), true);
    hash.update(header);
    hash.update(bytes);
  }
  return hash.update(JSON.stringify(world.host)).digest("hex");
};
const source = await read(`${cache}/research/bound-vfx-playback.json`),
  schedule = await read(`${cache}/research/parent-missile-inputs.json`),
  nativeBytes = await raw(`${cache}/research/parent-missiles-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes));
check(
  schedule.sourceSha256 ===
    sha(await raw(`${cache}/research/bound-vfx-playback.json`)) &&
    native.inputSha256 ===
      sha(await raw(`${cache}/research/parent-missile-inputs.json`)) &&
    native.counts.returningBursts === 2,
  "Unmatched timeline input/native reference",
);
for (const report of [source, schedule])
  for (const [name, digest] of Object.entries(report.sources))
    check(
      sha(await raw(`${root}/${name}`)) === digest,
      `Changed timeline source: ${name}`,
    );
for (const [name, digest] of Object.entries(native.sources))
  check(
    sha(await raw(resolve(import.meta.dir, name))) === digest,
    `Changed native producer: ${name}`,
  );
for (const report of [source, schedule, native])
  for (const [path, digest] of Object.entries(report.inputs))
    check(sha(await raw(path)) === digest, `Changed timeline input: ${path}`);
const bulkPackageBytes = await raw(
    `${assets}/latest-unicorn-bulk/package.json`,
  ),
  bulk = JSON.parse(new TextDecoder().decode(bulkPackageBytes));
const common = {
  profile: await read(`${assets}/decoder-16.21-macos/profile.json`),
  image: await raw(`${assets}/decoder-16.21-macos/image.bin`),
  spawnBytes: await raw(`${assets}/decoder-16.21-macos/vfx-spawn.json`),
  abiBytes: await raw(`${assets}/latest-parent-frame-runtime/package.json`),
  cachePackageBytes: await raw(
    `${assets}/latest-parent-frame-caches/package.json`,
  ),
  mathPackageBytes: await raw(`${assets}/latest-parent-math/package.json`),
  runtimeBytes: await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
  bulkPackageBytes,
  bulkWasmBytes: await raw(`${assets}/latest-unicorn-bulk/${bulk.file}`),
};
check(
  sha(common.image) === native.decoderImageSha256,
  "Timeline native image changed",
);
for (const block of native.originalBlocks)
  check(
    sha(common.image.subarray(block.rva, block.rva + block.size)) ===
      block.sha256,
    "Timeline original code changed",
  );
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
const counts = {
  bursts: 0,
  parents: 0,
  nativeWorldFrames: 0,
  nativeGeometryRecords: 0,
  fractionalComparisons: 0,
  repeatedSamples: 0,
  backwardSeeks: 0,
  hiddenBeforeBirth: 0,
  completedBursts: 0,
  completedIdleSamples: 0,
  canonicalWorldComparisons: 0,
  completedIdleWorldComparisons: 0,
};
const results = [],
  began = performance.now();
for (let bi = 0; bi < schedule.bursts.length; bi++) {
  const burst = schedule.bursts[bi],
    reference = native.cases[bi];
  const traces = source.traces
    .filter(
      (t) =>
        t.effectId === burst.effectId &&
        Math.fround(t.startTime) === burst.startTime,
    )
    .sort((a, b) => a.sequence - b.sequence);
  const client = new LatestParentWorkerClient(),
    manual = new LatestParentWorkerClient();
  const ref = catalog.caches.find((c) => c.effectId === burst.effectId),
    cacheBytes = await raw(`${assets}/latest-parent-frame-caches/${ref.file}`);
  const initialize = (client) =>
    client.initialize({
      assetBase: "http://127.0.0.1:4180/assets/",
      runtimeModuleUrl: pathToFileURL(
        `${assets}/vendor/unicorn_x86_candidate.mjs`,
      ).href,
      options: { ...common, image: common.image.slice(), cacheBytes },
      transferImage: true,
    });
  try {
    await initialize(client);
    const summary = await client.initializeTimeline(traces);
    equal(
      summary.parents,
      reference.parents.map((p) => ({
        sequence: p.sequence,
        ownership: p.ownership,
      })),
      "Timeline creation ownership differs",
    );
    counts.parents += summary.parents.length;
    const before = await client.sampleTimeline(
      burst.startTime - 1,
      schedule.camera,
    );
    check(
      before.beforeBirth &&
        before.simulationTime === null &&
        before.canonicalSteps === 0 &&
        before.parents.every(
          (p) => p.visible === false && !Object.hasOwn(p, "geometry"),
        ),
      "Before-birth visibility executed simulation",
    );
    counts.hiddenBeforeBirth++;
    await initialize(manual);
    const handles = new Map();
    for (const p of burst.parents)
      handles.set(
        p.sequence,
        (
          await manual.createParent({
            seed: BigInt(p.seed),
            clock: { ...p.clock, ticks: p.clock.ticks.map(BigInt) },
            placement: p.placement,
          })
        ).handle,
      );
    for (let fi = 0; fi < burst.frames.length; fi++) {
      const frame = burst.frames[fi];
      const actual = await client.sampleTimeline(frame.time, schedule.camera);
      equal(
        actual.parents.map((p) => ({
          sequence: p.sequence,
          geometry: geometry(p.geometry),
        })),
        reference.frames[fi].parents.map((p) => ({
          sequence: p.sequence,
          geometry: p.geometry,
        })),
        `Canonical timeline/native geometry differs: ${bi}/${fi}`,
      );
      check(
        !actual.fractionalStep &&
          actual.simulationTime === frame.time &&
          actual.parents.every((p) => p.visible && p.time === frame.time),
        "Canonical timeline metadata differs",
      );
      counts.nativeWorldFrames++;
      counts.nativeGeometryRecords += actual.parents.reduce(
        (n, p) => n + p.geometry.length,
        0,
      );
      await manual.frame(
        frame.updates.map(({ sequence, ...u }) => ({
          ...u,
          handle: handles.get(sequence),
        })),
        schedule.camera,
      );
      if ([5, 9, 12].includes(fi)) {
        const token = await manual.checkpoint();
        const next = burst.frames[fi + 1].time,
          time = Math.fround((frame.time + next) / 2);
        const camera =
          fi === 9
            ? {
                position: [10000, 11000, 500],
                right: [0, 0, 1],
                up: [1, 0, 0],
                axis: [0, 1, 0],
              }
            : schedule.camera;
        const expected = await manual.frame(
          traces.map((t) => ({
            handle: handles.get(t.sequence),
            time,
            maxSubsteps: 20,
            placement: parentMissilePlacement(t, time),
          })),
          camera,
        );
        const fractional = await client.sampleTimeline(time, camera);
        equal(
          fractional.parents.map((p) => geometry(p.geometry)),
          expected.parents.map((p) => geometry(p.geometry)),
          `Fractional timeline/manual geometry differs: ${bi}/${fi}`,
        );
        check(
          fractional.fractionalStep,
          "Fractional sample advanced the canonical cursor",
        );
        counts.fractionalComparisons++;
        equal(
          await client.sampleTimeline(time, camera),
          fractional,
          "Repeated fractional display changed output",
        );
        counts.repeatedSamples++;
        await manual.restore(token);
        await manual.releaseCheckpoint(token);
      }
    }
    const actualWorld = await client.worldState(),
      expectedWorld = await manual.worldState();
    if (worldDigest(actualWorld) !== worldDigest(expectedWorld)) {
      const differences = actualWorld.memory.map(([address, bytes], i) => {
        const expected = expectedWorld.memory[i][1],
          first = [];
        let count = 0;
        for (
          let offset = 0;
          offset < Math.max(bytes.length, expected.length);
          offset++
        )
          if (bytes[offset] !== expected[offset]) {
            count++;
            if (first.length < 24)
              first.push({
                offset,
                address: address + offset,
                actual: bytes[offset],
                expected: expected[offset],
              });
          }
        return { address, count, first };
      });
      await Bun.write(
        `${cache}/research/parent-timeline-world-difference.json`,
        JSON.stringify(
          {
            burst: bi,
            differences,
            hostEqual: isDeepStrictEqual(actualWorld.host, expectedWorld.host),
            actualHost: actualWorld.host,
            expectedHost: expectedWorld.host,
          },
          null,
          2,
        ),
      );
      throw Error("Presentation samples changed the canonical CPU world");
    }
    counts.canonicalWorldComparisons++;
    for (const fi of [5, 2, 12, 0, burst.frames.length - 1]) {
      const actual = await client.sampleTimeline(
        burst.frames[fi].time,
        schedule.camera,
      );
      equal(
        actual.parents.map((p) => geometry(p.geometry)),
        reference.frames[fi].parents.map((p) => p.geometry),
        `Backward timeline/native geometry differs: ${bi}/${fi}`,
      );
      counts.backwardSeeks++;
    }
    const completion = await client.sampleTimeline(
      burst.startTime + 3,
      schedule.camera,
    );
    check(
      completion.nativeCompleteAt !== null &&
        completion.nativeCompleteAt <= burst.startTime + 3 &&
        completion.parents.every((p) => p.visible === false),
      "Native completion did not finish all parent pools",
    );
    counts.completedBursts++;
    const completedWorld = worldDigest(await client.worldState());
    for (const time of [burst.startTime + 5, burst.startTime + 60]) {
      const idle = await client.sampleTimeline(time, schedule.camera);
      check(
        idle.canonicalSteps === 0 &&
          !idle.fractionalStep &&
          idle.nativeCompleteAt === completion.nativeCompleteAt &&
          idle.parents.every((p) => p.visible === false),
        "Completed timeline continued simulation",
      );
      counts.completedIdleSamples++;
      equal(
        worldDigest(await client.worldState()),
        completedWorld,
        "Completed idle sample changed the CPU world",
      );
      counts.completedIdleWorldComparisons++;
    }
    const rewind = await client.sampleTimeline(
      burst.frames[5].time,
      schedule.camera,
    );
    equal(
      rewind.parents.map((p) => geometry(p.geometry)),
      reference.frames[5].parents.map((p) => p.geometry),
      "Completion prevented backward seek",
    );
    counts.backwardSeeks++;
    results.push({
      burst: bi,
      nativeCompleteAt: completion.nativeCompleteAt,
      completionCanonicalSteps: completion.canonicalSteps,
    });
    counts.bursts++;
    console.log(
      JSON.stringify({
        burst: bi,
        nativeCompleteAt: completion.nativeCompleteAt,
        elapsedMs: performance.now() - began,
      }),
    );
  } finally {
    client.close();
    manual.close();
    await Promise.all([client.termination, manual.termination]);
  }
}
const sources = {};
for (const name of [
  "latest-parent-missile-timeline.mjs",
  "latest-parent-missile-inputs.mjs",
  "latest-missile-playback.mjs",
  "latest-parent-placement.mjs",
  "latest-parent-frames.mjs",
  "latest-world-effect-abi.mjs",
  "latest-world-descriptor-abi.mjs",
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
  "tools/inspect-parent-timeline.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "seekable-complete-parent-timeline-comparison",
  nativeObservationSha256: sha(nativeBytes),
  inputs,
  sources,
  counts,
  results,
  mismatchCount: 0,
  elapsedMs: performance.now() - began,
  scope: {
    realBunModuleWorkers: true,
    canonicalGeometryComparedToNative: true,
    fractionalGeometryComparedToControlledWasm: true,
    allUpdatesBeforeGeometry: true,
    completionFromNativeParentFlagsAndEmptyPools: true,
    originalDestructionImplemented: false,
    independentBurstContexts: true,
    suppliedActivationStopSeedAndBasis: true,
    originalEffectEventMapping: false,
    browserExecuted: false,
    mainViewerIntegrated: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/parent-timeline.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
