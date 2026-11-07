// Real module workers, static HTTP inputs and original native parent reference.
// No browser automation or League process is used.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { LatestParentWorkerClient } from "../latest-parent-worker-client.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`;
const effect = process.argv[3];
const sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  inputs = {};
const raw = async (p) => {
  const b = new Uint8Array(await Bun.file(p).arrayBuffer());
  inputs[p] = sha(b);
  return b;
};
const read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
const nativeBytes = await raw(`${cache}/research/parent-frames-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  proof = await read(`${cache}/research/parent-frames-inspection.json`);
if (
  proof.observationSha256 !== sha(nativeBytes) ||
  proof.mismatchCount ||
  native.counts.roots !== 10
)
  throw Error("Uninspected native parent worker reference");
for (const [name, digest] of Object.entries(native.sources))
  if (sha(await raw(resolve(import.meta.dir, name))) !== digest)
    throw Error(`Native parent producer changed: ${name}`);
const cases = effect
  ? native.cases.filter((c) => c.effectId === effect)
  : native.cases;
if (!cases.length) throw Error("Unknown parent worker effect");
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
const catalog = JSON.parse(new TextDecoder().decode(common.cachePackageBytes)),
  assetBase = "http://127.0.0.1:4180/assets/",
  runtimeModuleUrl = pathToFileURL(
    `${assets}/vendor/unicorn_x86_candidate.mjs`,
  ).href;
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
const reject = async (fn, expected) => {
  let failure;
  try {
    await fn();
  } catch (error) {
    failure = error;
  }
  check(
    failure?.message === expected,
    `Wrong worker rejection: ${failure?.message}; expected ${expected}`,
  );
};
const counts = {
  roots: cases.length,
  forwardFrames: 0,
  restoredFrames: 0,
  geometryRecords: 0,
  worldContinuations: 0,
  imageTransfers: 0,
  exportIsolationChecks: 0,
  ownershipRejections: 0,
  fatalBoundaryChecks: 0,
  cancelChecks: 0,
};
const checks = [],
  worlds = [],
  began = performance.now();
let heartbeat = 0,
  maxHeartbeatGapMs = 0,
  lastHeartbeat = performance.now();
const timer = setInterval(() => {
  const now = performance.now();
  maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - lastHeartbeat);
  lastHeartbeat = now;
  heartbeat++;
}, 10);
try {
  for (const c of cases) {
    const client = new LatestParentWorkerClient();
    try {
      const ref = catalog.caches.find((r) => r.effectId === c.effectId),
        image = common.image.slice();
      await client.initialize({
        assetBase,
        runtimeModuleUrl,
        options: {
          ...common,
          image,
          cacheBytes: await raw(
            `${assets}/latest-parent-frame-caches/${ref.file}`,
          ),
        },
        transferImage: true,
      });
      check(
        image.byteLength === 0,
        "Parent image was copied instead of transferred",
      );
      counts.imageTransfers++;
      check(
        client.summary.effectId === c.effectId &&
          client.summary.build === native.build &&
          client.summary.protocol === native.protocol,
        "Wrong worker parent cache identity",
      );
      const { handle, ownership } = await client.createParent({
        seed: 9876n,
        clock: {
          ticks: [2000000000n, 2000000000n, 2000000000n],
          mode: 0,
          timebase: [1, 1],
        },
      });
      check(
        isDeepStrictEqual(ownership, c.ownership),
        "Parent worker factory ownership differs",
      );
      check(
        isDeepStrictEqual((await client.inspect(handle)).state, c.initialState),
        "Parent worker initial state differs",
      );
      let checkpoint,
        checkpointWorld,
        isolated = false;
      for (const f of c.frames) {
        const transition = c.suspension.find((s) => s.beforeTick === f.tick);
        const update = {
          handle,
          time: f.time,
          maxSubsteps: 20,
          ...(transition ? { suspended: transition.suspended } : {}),
        };
        const frame = await client.frame([update], native.camera, {
          captureState: true,
        });
        check(
          isDeepStrictEqual(frame.camera, native.camera) &&
            frame.parents.length === 1,
          "Parent worker frame envelope changed",
        );
        const { id, ...actual } = frame.parents[0];
        actual.geometry = geometry(actual.geometry);
        const expected = Object.fromEntries(
          ["time", "substeps", "state", "geometry"].map((k) => [k, f[k]]),
        );
        check(
          isDeepStrictEqual(actual, expected),
          `Worker/native parent frame differs: ${c.effectId} ${f.tick}`,
        );
        counts.forwardFrames++;
        counts.geometryRecords += actual.geometry.length;
        checks.push({
          effectId: c.effectId,
          tick: f.tick,
          restored: false,
          nativeStateAndGeometrySha256: f.stateAndGeometrySha256,
        });
        if (!isolated) {
          const exported = frame.parents[0].geometry.find(
            (g) => g.vertices.length,
          );
          if (exported) {
            exported.vertices[0] ^= 255;
            exported.indices.fill(255);
            exported.draw.fill(255);
            const repeated = await client.render(handle, native.camera);
            check(
              isDeepStrictEqual(geometry(repeated.geometry), f.geometry),
              "Transferred output buffers alias native CPU memory",
            );
            isolated = true;
            counts.exportIsolationChecks++;
          }
        }
        if (f.tick === 12) {
          checkpoint = await client.checkpoint();
          checkpointWorld = digestWorld(await client.worldState());
        }
      }
      check(
        isolated && checkpoint,
        "Missing worker export/checkpoint coverage",
      );
      const finalWorld = digestWorld(await client.worldState()),
        finalCheckpoint = await client.checkpoint();
      const { handle: future } = await client.createParent({
        seed: 7654321n,
        clock: {
          ticks: [3000000000n, 3000000000n, 3000000000n],
          mode: 0,
          timebase: [1, 1],
        },
      });
      const futureWorld = digestWorld(await client.worldState()),
        futureCheckpoint = await client.checkpoint();
      await client.restore(checkpoint);
      check(
        digestWorld(await client.worldState()) === checkpointWorld,
        "Worker restore omitted CPU state",
      );
      await reject(
        () => client.inspect(future),
        "Unowned or inactive parent worker handle",
      );
      await reject(
        () => client.inspect({ ...handle }),
        "Unowned or inactive parent worker handle",
      );
      await reject(
        () => client.restore(Object.freeze({})),
        "Unowned parent worker checkpoint",
      );
      counts.ownershipRejections += 3;
      for (const f of c.frames.slice(12)) {
        const transition = c.suspension.find((s) => s.beforeTick === f.tick);
        const frame = await client.frame(
          [
            {
              handle,
              time: f.time,
              maxSubsteps: 20,
              ...(transition ? { suspended: transition.suspended } : {}),
            },
          ],
          native.camera,
        );
        const { id, ...actual } = frame.parents[0];
        check(
          !Object.hasOwn(actual, "state"),
          "Normal parent worker frames include diagnostic state dumps",
        );
        actual.geometry = geometry(actual.geometry);
        const expected = Object.fromEntries(
          ["time", "substeps", "geometry"].map((k) => [k, f[k]]),
        );
        check(
          isDeepStrictEqual(actual, expected),
          `Worker/native restored geometry differs: ${c.effectId} ${f.tick}`,
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
        digestWorld(await client.worldState()) === finalWorld,
        "Worker continuation changed complete CPU world",
      );
      await client.restore(futureCheckpoint);
      await client.inspect(future);
      check(
        digestWorld(await client.worldState()) === futureWorld,
        "Worker future checkpoint omitted a parent",
      );
      await client.restore(finalCheckpoint);
      check(
        digestWorld(await client.worldState()) === finalWorld,
        "Worker checkpoint switching changed terminal state",
      );
      for (const token of [checkpoint, futureCheckpoint, finalCheckpoint])
        await client.releaseCheckpoint(token);
      await reject(
        () => client.restore(checkpoint),
        "Unowned parent worker checkpoint",
      );
      counts.ownershipRejections++;
      counts.worldContinuations++;
      worlds.push({
        effectId: c.effectId,
        checkpointWorldSha256: checkpointWorld,
        finalWorldSha256: finalWorld,
        futureWorldSha256: futureWorld,
      });
      await reject(
        () =>
          client.request("frame", {
            updates: [],
            camera: native.camera,
            captureState: false,
          }),
        "Parent frame must cover every live parent once",
      );
      check(client.closed, "Failed parent worker remained usable");
      counts.fatalBoundaryChecks++;
      console.log(
        JSON.stringify({
          effectId: c.effectId,
          forward: 60,
          restored: 48,
          elapsedMs: performance.now() - began,
        }),
      );
    } finally {
      client.close();
      await client.termination;
    }
  }
  const cancel = new LatestParentWorkerClient(),
    image = common.image.slice(),
    ref = catalog.caches.find((r) => r.effectId === cases[0].effectId);
  const opening = cancel
    .initialize({
      assetBase,
      runtimeModuleUrl,
      options: {
        ...common,
        image,
        cacheBytes: await raw(
          `${assets}/latest-parent-frame-caches/${ref.file}`,
        ),
      },
      transferImage: true,
    })
    .then(
      () => null,
      (error) => error,
    );
  cancel.close();
  const cancelled = await opening;
  await cancel.termination;
  check(
    cancelled?.name === "AbortError" && image.byteLength === 0,
    "Closing a loading parent worker did not cancel/transfer ownership",
  );
  counts.cancelChecks++;
} finally {
  clearInterval(timer);
}
const sources = {};
for (const name of [
  "latest-parent-missile-timeline.mjs",
  "latest-parent-missile-inputs.mjs",
  "latest-missile-playback.mjs",
  "latest-parent-worker.mjs",
  "latest-parent-worker-client.mjs",
  "latest-particle-worker-client.mjs",
  "latest-parent-frames.mjs",
  "latest-parent-placement.mjs",
  "latest-parent-math.mjs",
  "latest-math-isa.mjs",
  "latest-fused-math.mjs",
  "latest-unicorn-bulk.mjs",
  "native-decoder.mjs",
  "latest-vfx-spawn.mjs",
  "structural-comparison.mjs",
  "tools/inspect-parent-workers.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const browserBuild = await Bun.build({
  entrypoints: [
    `${root}/latest-parent-worker.mjs`,
    `${root}/latest-parent-worker-client.mjs`,
  ],
  target: "browser",
  write: false,
});
check(
  browserBuild.success && browserBuild.outputs.length === 2,
  "Parent browser worker/client build failed",
);
const bundles = [];
for (const output of browserBuild.outputs) {
  const bytes = new Uint8Array(await output.arrayBuffer());
  bundles.push({ file: output.path, bytes: bytes.length, sha256: sha(bytes) });
}
const result = {
  schema: 1,
  kind: "complete-parent-module-worker-comparison",
  observationSha256: sha(nativeBytes),
  inputs,
  sources,
  counts,
  checks,
  worlds,
  bundles,
  heartbeat: { count: heartbeat, maxGapMs: maxHeartbeatGapMs },
  elapsedMs: performance.now() - began,
  mismatchCount: 0,
  scope: {
    realBunModuleWorkers: true,
    staticHttpAssets: true,
    transferredGeometryBuffers: true,
    diagnosticStateComparedForward: true,
    normalStateCaptureDisabledOnRestore: true,
    completeCpuWorldRestoration: true,
    hostEventLoopHeartbeatOnly: true,
    browserExecuted: false,
    mainViewerIntegrated: false,
    matchLifecycleMapping: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/parent-workers${effect ? "-partial" : ""}.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({ counts, mismatchCount: 0, heartbeat: result.heartbeat }),
);
