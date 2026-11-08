// Real module workers and HTTP asset loading; no browser or DOM is automated.
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { LatestParticleWorkerClient } from "../latest-particle-worker-client.mjs";
import { LatestParticleFrameGate } from "../latest-particle-frame-gate.mjs";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: inspect-particle-workers.mjs <cache>");
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
  source = await read(`${cache}/research/bound-vfx-playback.json`),
  reference = await read(`${cache}/research/particle-profile-bulk.json`),
  profile = await read(`${decoder}/profile.json`),
  bulkPackageBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
  bulkMeta = JSON.parse(new TextDecoder().decode(bulkPackageBytes)),
  common = {
    profile,
    image: await raw(`${decoder}/image.bin`),
    spawnBytes: await raw(`${decoder}/vfx-spawn.json`),
    emitterBytes: await raw(`${decoder}/vfx-emitter.json`),
    boundBytes: await raw(`${decoder}/vfx-bound-quads.json`),
    controlBytes: await raw(`${assets}/latest-vfx-control/package.json`),
    bulkPackageBytes,
    bulkWasmBytes: await raw(`${assets}/latest-unicorn-bulk/${bulkMeta.file}`),
    runtimeBytes: await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
  },
  configs = [
    {
      kind: "quad",
      gpu: await read(`${assets}/latest-complete-quad-gpu/package.json`),
      options: {
        ...common,
        packageBytes: common.boundBytes,
        postloadBytes: await raw(`${decoder}/vfx-postload.json`),
      },
    },
    {
      kind: "trail",
      gpu: await read(`${assets}/latest-trail-particles/gpu.json`),
      options: {
        ...common,
        packageBytes: await raw(
          `${assets}/latest-trail-particles/package.json`,
        ),
      },
    },
  ],
  clients = configs.map(() => new LatestParticleWorkerClient()),
  effects = new Set(source.traces.map((t) => t.effectId));
for (const [path, expected] of Object.entries(reference.inputs))
  if (sha(await raw(path)) !== expected)
    throw Error("Worker reference input changed");
for (const [name, expected] of Object.entries(reference.sources))
  if (sha(await raw(`${root}/${name}`)) !== expected)
    throw Error("Worker reference source changed");
const workerBundleSources = {};
const workerBuild = await Bun.build({
  entrypoints: [`${root}/latest-particle-worker.mjs`],
  target: "browser",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "record-worker-inputs",
      setup(build) {
        build.onLoad({ filter: /\.mjs$/ }, async ({ path }) => {
          const bytes = await raw(path);
          workerBundleSources[relative(root, path).replaceAll("\\", "/")] =
            sha(bytes);
          return { contents: new TextDecoder().decode(bytes), loader: "js" };
        });
      },
    },
  ],
});
if (!workerBuild.success || workerBuild.outputs.length !== 1)
  throw new AggregateError(
    workerBuild.logs,
    "Particle browser worker build failed",
  );
const workerBundle = new Uint8Array(await workerBuild.outputs[0].arrayBuffer());
await Bun.write(
  `${cache}/research/particle-worker-browser.bundle.mjs`,
  workerBundle,
);
let heartbeat = 0,
  last = performance.now(),
  maxHeartbeatGapMs = 0;
const interval = setInterval(() => {
  const now = performance.now();
  maxHeartbeatGapMs = Math.max(maxHeartbeatGapMs, now - last);
  last = now;
  heartbeat++;
}, 10);
const counts = {
  frames: 0,
  sampleCalls: 0,
  geometryDigestChecks: 0,
  cancelChecks: 0,
  failureChecks: 0,
  stalePresentationChecks: 0,
  reloadResetChecks: 0,
  imageTransferChecks: 0,
};
const elapsed = [];
try {
  await Promise.all(
    configs.map(async (config, i) => {
      await clients[i].initialize({
        kind: config.kind,
        traces: source.traces,
        assetBase: "http://127.0.0.1:4180/assets/",
        runtimeModuleUrl: pathToFileURL(
          `${assets}/vendor/unicorn_x86_candidate.mjs`,
        ).href,
        options: config.options,
      });
      for (const b of config.gpu.emitters.filter((b) =>
        effects.has(b.effectId),
      ))
        await clients[i].bindEmitter(
          b.effectId,
          b.emitterIndex,
          b.sourceDefinitionSha256,
        );
    }),
  );
  for (const expected of reference.frames) {
    const start = performance.now(),
      packets = await Promise.all(
        clients.map((c) => c.frame(expected.time, source.camera)),
      );
    elapsed.push(performance.now() - start);
    const actual = [];
    let sampleCalls = 0,
      particles = 0;
    for (let i = 0; i < packets.length; i++) {
      const packet = packets[i];
      if (
        packet.time !== expected.time ||
        !isDeepStrictEqual(packet.view, source.camera)
      )
        throw Error("Worker changed frame time/camera");
      sampleCalls += packet.sampleCalls;
      for (const s of packet.draws) {
        particles += s.particleCount;
        actual.push({
          kind: configs[i].kind,
          sequence: s.sequence,
          emitterIndex: s.emitterIndex,
          particleCount: s.particleCount,
          graphSha256: s.graphSha256,
          geometrySha256: sha(
            new TextEncoder().encode(JSON.stringify(s.geometry)),
          ),
        });
      }
    }
    if (
      sampleCalls !== expected.samples ||
      particles !== expected.particles ||
      !isDeepStrictEqual(actual, expected.draws)
    )
      throw Error(`Worker frame differs at ${expected.time}`);
    counts.frames++;
    counts.sampleCalls += sampleCalls;
    counts.geometryDigestChecks += actual.length;
  }
  let failed = false;
  try {
    await clients[0].frame(NaN, source.camera);
  } catch (error) {
    failed = error.message.includes("Invalid worker particle frame inputs");
  }
  if (!failed || !clients[0].closed)
    throw Error("Worker input error did not fail closed");
  counts.failureChecks++;
  const pending = clients[1].frame(
    source.traces[0].startTime + 0.5,
    source.camera,
  );
  clients[1].close();
  try {
    await pending;
    throw Error("Closed worker completed an owned pending request");
  } catch (error) {
    if (error.name !== "AbortError") throw error;
    counts.cancelChecks++;
  }
  await Promise.all(clients.map((c) => c.termination));
  const replacement = new LatestParticleWorkerClient();
  try {
    const replacementOptions = {
      ...configs[0].options,
      image: common.image.slice(),
    };
    await replacement.initialize({
      kind: "quad",
      traces: source.traces,
      assetBase: "http://127.0.0.1:4180/assets/",
      runtimeModuleUrl: pathToFileURL(
        `${assets}/vendor/unicorn_x86_candidate.mjs`,
      ).href,
      options: replacementOptions,
      transferImage: true,
    });
    if (replacementOptions.image.byteLength !== 0)
      throw Error("Worker image transfer retained shared host ownership");
    counts.imageTransferChecks++;
    const binding = configs[0].gpu.emitters.find((b) =>
      effects.has(b.effectId),
    );
    await replacement.bindEmitter(
      binding.effectId,
      binding.emitterIndex,
      binding.sourceDefinitionSha256,
    );
    const expected = reference.frames.find(
        (f) =>
          f.time === source.traces[0].startTime + 5 / 60 &&
          f.phase === "forward",
      ),
      packet = await replacement.frame(expected.time, source.camera),
      actual = packet.draws.map((s) => ({
        kind: "quad",
        sequence: s.sequence,
        emitterIndex: s.emitterIndex,
        particleCount: s.particleCount,
        graphSha256: s.graphSha256,
        geometrySha256: sha(
          new TextEncoder().encode(JSON.stringify(s.geometry)),
        ),
      }));
    if (
      !isDeepStrictEqual(
        actual,
        expected.draws.filter(
          (d) => d.kind === "quad" && d.emitterIndex === binding.emitterIndex,
        ),
      )
    )
      throw Error("Replacement worker retained another replay's state");
    counts.reloadResetChecks++;
    replacement.worker.postMessage({
      version: 99,
      id: 1,
      type: "frame",
      payload: {},
    });
    let rejectedProtocol = false;
    try {
      await replacement.frame(expected.time, source.camera);
    } catch (error) {
      rejectedProtocol = error.message.includes(
        "Invalid particle worker protocol envelope",
      );
    }
    if (!rejectedProtocol || !replacement.closed)
      throw Error("Broken worker protocol left a presentation pending");
    counts.failureChecks++;
  } finally {
    replacement.close();
    await replacement.termination;
  }
  const gate = new LatestParticleFrameGate(),
    committed = [],
    errors = [];
  let complete;
  gate.start(
    () =>
      new Promise((r) => {
        complete = r;
      }),
    (v) => committed.push(v),
    (e) => errors.push(e),
  );
  if (
    gate.start(
      () => Promise.resolve("duplicate"),
      (v) => committed.push(v),
      (e) => errors.push(e),
    )
  )
    throw Error("Frame gate queued concurrent presentations");
  gate.invalidate();
  complete("obsolete");
  await gate.pending;
  if (committed.length || errors.length || gate.busy)
    throw Error("Seek committed an obsolete frame");
  counts.stalePresentationChecks++;
  gate.start(
    () => Promise.resolve("current"),
    (v) => committed.push(v),
    (e) => errors.push(e),
  );
  await gate.pending;
  if (!isDeepStrictEqual(committed, ["current"]))
    throw Error("Frame gate lost the current presentation");
  gate.start(
    () => Promise.reject(Error("current failure")),
    () => {},
    (e) => errors.push(e),
  );
  await gate.pending;
  if (errors.length !== 1) throw Error("Frame gate suppressed current errors");
  counts.failureChecks++;
} finally {
  clearInterval(interval);
  for (const client of clients) client.close();
  await Promise.all(clients.map((c) => c.termination));
}
const sources = { ...workerBundleSources };
for (const name of [
  "latest-particle-worker.mjs",
  "latest-particle-worker-client.mjs",
  "latest-particle-frame-gate.mjs",
  "latest-unicorn-bulk.mjs",
  "latest-trail-renderer.mjs",
  "latest-quad-pool-renderer.mjs",
  "latest-viewer.mjs",
  "tools/inspect-particle-workers.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "particle-worker-frame-comparison",
  inputs,
  sources,
  counts,
  mismatches: 0,
  browserWorkerBundleSha256: sha(workerBundle),
  hostEventLoop: { heartbeat, intervalMs: 10, maxGapMs: maxHeartbeatGapMs },
  workerRoundTrip: {
    maximumMs: Math.max(...elapsed),
    totalMs: elapsed.reduce((a, b) => a + b, 0),
  },
  scope: {
    actualModuleWorkers: true,
    browserWorkerBundleBuilt: true,
    realHttpGraphLoading: true,
    sameNativeSimulationAndGeometry: true,
    boundedPresentationConcurrency: true,
    obsoleteSeekResponseDiscarded: true,
    pendingTerminationVerified: true,
    sourceIntegrated: true,
    browserRun: false,
    browserResponsivenessEstablished: false,
    gpuSubmission: false,
  },
};
await Bun.write(
  `${cache}/research/particle-workers-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    counts,
    hostEventLoop: result.hostEventLoop,
    workerRoundTrip: result.workerRoundTrip,
  }),
);
