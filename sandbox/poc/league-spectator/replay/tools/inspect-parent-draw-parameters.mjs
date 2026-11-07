// Compare the original draw prefix in native Unicorn, WASM and real workers.
// Controlled matrices/poses are supplied inputs, not decoded match camera data.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  createLatestParentFrames,
  PARENT_DRAW_CACHES_SHA,
} from "../latest-parent-frames.mjs";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";
import { LatestParentWorkerClient } from "../latest-parent-worker-client.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  workerMode = process.argv.includes("--worker"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  directory = `${assets}/latest-parent-draw-caches`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  nativeBytes = await raw(
    `${cache}/research/parent-draw-parameters-native.json`,
  ),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  bulkPackageBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
  bulk = JSON.parse(new TextDecoder().decode(bulkPackageBytes)),
  common = {
    profile: await read(`${assets}/decoder-16.21-macos/profile.json`),
    image: await raw(`${assets}/decoder-16.21-macos/image.bin`),
    spawnBytes: await raw(`${assets}/decoder-16.21-macos/vfx-spawn.json`),
    abiBytes: await raw(`${assets}/latest-parent-frame-runtime/package.json`),
    cachePackageBytes: await raw(`${directory}/package.json`),
    mathPackageBytes: await raw(`${assets}/latest-parent-math/package.json`),
    drawParameterBytes: await raw(
      `${assets}/latest-parent-draw-parameters/package.json`,
    ),
    runtimeBytes: await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
    bulkPackageBytes,
    bulkWasmBytes: await raw(`${assets}/latest-unicorn-bulk/${bulk.file}`),
  },
  catalog = JSON.parse(new TextDecoder().decode(common.cachePackageBytes)),
  check = (v, m) => {
    if (!v) throw Error(m);
  };
check(
  native.kind === "original-parent-draw-parameter-observations" &&
    !native.scope.partialSelection &&
    native.counts.roots === 14 &&
    native.counts.returningRoots === 14 &&
    native.counts.drawParameterRecords === 332 &&
    catalog.observationSha256 === sha(nativeBytes) &&
    sha(common.cachePackageBytes) === PARENT_DRAW_CACHES_SHA,
  "Full original draw parameter cohort and pinned cache required",
);
for (const [name, digest] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Native draw producer changed: ${name}`,
  );
for (const [path, digest] of Object.entries(native.inputs))
  check(sha(await raw(path)) === digest, `Native draw input changed: ${path}`);
for (const b of native.originalBlocks)
  check(
    sha(common.image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original draw code changed",
  );
const { default: factory } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  uc = workerMode
    ? null
    : await createLatestBulkUnicorn(
        factory,
        common.runtimeBytes,
        bulkPackageBytes,
        common.bulkWasmBytes,
      ),
  counts = {
    roots: 0,
    forwardFrames: 0,
    restoredFrames: 0,
    parameterRecords: 0,
    memcmpCalls: 0,
    worldRestorations: 0,
    binaryRecords: 0,
  },
  cases = [],
  began = performance.now();
function worldDigest(world) {
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
}
const unbinary = (list) =>
  list.map(({ vertices, indices, draw, ...g }) => ({
    ...g,
    verticesHex: Buffer.from(vertices).toString("hex"),
    indicesHex: Buffer.from(indices).toString("hex"),
    drawHex: Buffer.from(draw).toString("hex"),
  }));
for (const c of native.cases) {
  const ref = catalog.caches.find((r) => r.effectId === c.effectId),
    options = { ...common, cacheBytes: await raw(`${directory}/${ref.file}`) },
    runtime = workerMode
      ? new LatestParentWorkerClient()
      : await createLatestParentFrames({
          ...options,
          uc,
          loadBytes: (name) => raw(`${directory}/${name}`),
          loadMathBytes: (name) => raw(`${assets}/latest-parent-math/${name}`),
        });
  try {
    if (workerMode)
      await runtime.initialize({
        assetBase: "http://127.0.0.1:4180/assets/",
        runtimeModuleUrl: pathToFileURL(
          `${assets}/vendor/unicorn_x86_candidate.mjs`,
        ).href,
        options: { ...options, image: common.image.slice() },
        transferImage: true,
      });
    const created = await runtime.createParent({
        seed: 9876n,
        clock: { ...c.clockInput, ticks: c.clockInput.ticks.map(BigInt) },
      }),
      handle = workerMode ? created.handle : created,
      initial = workerMode
        ? await runtime.inspect(handle)
        : {
            ownership: runtime.ownership(handle),
            state: runtime.state(handle),
          };
    check(
      isDeepStrictEqual(initial.ownership, c.ownership) &&
        isDeepStrictEqual(initial.state, c.initialState),
      "Draw parent initial state differs",
    );
    async function compare(f, restored, binary = false) {
      let actual;
      if (workerMode) {
        const result = await runtime.frame(
            [{ handle, time: f.time, maxSubsteps: 20, placement: f.pose }],
            native.camera,
            { captureState: true },
          ),
          { id, placement, ...step } = result.parents[0];
        actual = {
          ...step,
          geometry: unbinary(step.geometry),
          placement: placement.setters,
          sync: placement.sync,
        };
      } else {
        const placement = runtime.setPlacement(handle, f.pose);
        actual = runtime.advance(handle, f.time, 20);
        actual.geometry = runtime.render(handle, native.camera);
        actual.placement = placement.setters;
        actual.sync = placement.sync;
      }
      actual.drawParameters = [];
      for (const expected of f.drawParameters) {
        const { projectionSource, passHash, instanceOffset } = expected,
          value = await runtime.drawParameters(
            handle,
            expected.emitterIndex,
            { projectionSource, passHash, instanceOffset },
            { binary },
          );
        if (binary) {
          for (const [name, bytes] of Object.entries(value.values)) {
            check(
              bytes instanceof Uint8Array &&
                Buffer.from(bytes).toString("hex") === expected.values[name],
              "Binary parameter value differs",
            );
            value.values[name] = Buffer.from(bytes).toString("hex");
          }
          // Diagnostics do not execute extra native calls; compare canonical payload separately.
          value.memcmpCalls = expected.memcmpCalls;
          counts.binaryRecords++;
        } else counts.memcmpCalls += value.memcmpCalls.length;
        actual.drawParameters.push(value);
      }
      const expected = Object.fromEntries(
        [
          "time",
          "substeps",
          "state",
          "geometry",
          "placement",
          "sync",
          "drawParameters",
        ].map((k) => [k, f[k]]),
      );
      if (!isDeepStrictEqual(actual, expected)) {
        await Bun.write(
          `${cache}/research/parent-draw-parameters-difference.json`,
          JSON.stringify(
            {
              effectId: c.effectId,
              tick: f.tick,
              workerMode,
              restored,
              binary,
              actual,
              expected,
            },
            null,
            2,
          ),
        );
        throw Error(
          `Draw parameter frame differs: ${c.effectId} tick ${f.tick}`,
        );
      }
      counts[restored ? "restoredFrames" : "forwardFrames"]++;
      counts.parameterRecords += actual.drawParameters.length;
    }
    let checkpoint;
    for (const f of c.frames) {
      await compare(f, false);
      if (f.tick === 2) checkpoint = await runtime.checkpoint();
    }
    const final = worldDigest(await runtime.worldState());
    await runtime.restore(checkpoint);
    for (const f of c.frames.slice(2)) await compare(f, true);
    check(
      worldDigest(await runtime.worldState()) === final,
      "Restored draw CPU world differs",
    );
    await runtime.restore(checkpoint);
    for (const f of c.frames.slice(2)) await compare(f, true, true);
    check(
      worldDigest(await runtime.worldState()) === final,
      "Binary draw CPU world differs",
    );
    await runtime.releaseCheckpoint(checkpoint);
    counts.worldRestorations += 2;
    counts.roots++;
    cases.push({ effectId: c.effectId, finalCpuWorldSha256: final });
    console.log(
      JSON.stringify({
        effectId: c.effectId,
        roots: counts.roots,
        elapsedSeconds: (performance.now() - began) / 1000,
      }),
    );
  } finally {
    if (workerMode) {
      await runtime.request("dispose", null);
      runtime.close();
      await runtime.termination;
    } else runtime.close();
  }
}
const sources = {};
for (const name of [
  "latest-parent-frames.mjs",
  "latest-parent-draw-parameters.mjs",
  "latest-parent-placement.mjs",
  "latest-parent-math.mjs",
  "latest-unicorn-bulk.mjs",
  "latest-parent-worker.mjs",
  "latest-parent-worker-client.mjs",
  "tools/inspect-parent-draw-parameters.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: workerMode
    ? "worker-original-parent-draw-parameter-comparison"
    : "native-wasm-parent-draw-parameter-comparison",
  build: native.build,
  protocol: native.protocol,
  observationSha256: sha(nativeBytes),
  cachePackageSha256: sha(common.cachePackageBytes),
  inputs,
  sources,
  counts,
  cases,
  mismatchCount: 0,
  scope: {
    originalPrefixAndParameterBytes: true,
    completeStateGeometryAndPlacement: true,
    diagnosticComparisonsMatched: true,
    binaryParameterExportsMatched: true,
    wholeWorldRestoreCompared: true,
    actualModuleWorkers: workerMode,
    browserExecuted: false,
    gpuSubmitted: false,
    replayInputs: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/parent-draw-parameters-${workerMode ? "workers" : "comparison"}.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ counts, mismatchCount: 0 }));
