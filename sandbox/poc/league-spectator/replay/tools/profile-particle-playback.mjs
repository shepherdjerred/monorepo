// CPU-only full-burst replay workload, using the viewer's actual pool runtimes.
// Excludes THREE/WebGL submission and shader compilation. This is not browser FPS.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestQuadPoolPlayback } from "../latest-quad-pool-playback.mjs";
import { createLatestTrailPlayback } from "../latest-trail-playback.mjs";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";

const [arg, label, option] = process.argv.slice(2);
if (
  !arg ||
  !/^[a-z0-9-]+$/.test(label ?? "") ||
  process.argv.length > 5 ||
  (option && option !== "--bulk")
)
  throw Error("Usage: profile-particle-playback.mjs <cache> <label> [--bulk]");
const cache = resolve(arg),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`,
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  profile = await read(`${decoder}/profile.json`),
  source = await read(`${cache}/research/bound-vfx-playback.json`),
  sourceProof = await read(`${cache}/research/bound-vfx-playback-native.json`);
if (
  sourceProof.playbackSha256 !==
    inputs[`${cache}/research/bound-vfx-playback.json`] ||
  sourceProof.counts.mismatches ||
  source.build !== profile.clientVersion ||
  source.protocol !== profile.protocolDigest
)
  throw Error("Particle profile requires native-checked replay trajectories");
const { default: createUnicorn } = await import(
  pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
);
let createRuntime = createUnicorn;
if (option) {
  const runtimeBytes = await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
    packageBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
    meta = JSON.parse(new TextDecoder().decode(packageBytes)),
    wasmBytes = await raw(`${assets}/latest-unicorn-bulk/${meta.file}`);
  createRuntime = () =>
    createLatestBulkUnicorn(
      createUnicorn,
      runtimeBytes,
      packageBytes,
      wasmBytes,
    );
}
const common = {
    profile,
    image: await raw(`${decoder}/image.bin`),
    spawnBytes: await raw(`${decoder}/vfx-spawn.json`),
    emitterBytes: await raw(`${decoder}/vfx-emitter.json`),
    boundBytes: await raw(`${decoder}/vfx-bound-quads.json`),
    controlBytes: await raw(`${assets}/latest-vfx-control/package.json`),
  },
  started = performance.now(),
  quads = await createLatestQuadPoolPlayback({
    ...common,
    uc: await createRuntime(),
    postloadBytes: await raw(`${decoder}/vfx-postload.json`),
    packageBytes: common.boundBytes,
    loadGraphBytes: (p) => raw(`${decoder}/${p}`),
  }),
  trails = await createLatestTrailPlayback({
    ...common,
    uc: await createRuntime(),
    packageBytes: await raw(`${assets}/latest-trail-particles/package.json`),
    loadGraphBytes: (p) => raw(`${assets}/latest-trail-particles/${p}`),
  }),
  runtimes = [
    {
      name: "quad",
      runtime: quads,
      gpu: await read(`${assets}/latest-complete-quad-gpu/package.json`),
    },
    {
      name: "trail",
      runtime: trails,
      gpu: await read(`${assets}/latest-trail-particles/gpu.json`),
    },
  ],
  effects = new Map(
    source.traces.map((t) => [t.effectId, t.effect.definitionSha256]),
  );
for (const item of runtimes) {
  item.bindings = item.gpu.emitters.filter((e) => effects.has(e.effectId));
  for (const b of item.bindings) {
    if (b.sourceDefinitionSha256 !== effects.get(b.effectId))
      throw Error("Profile effect identity differs");
    await item.runtime.bindEmitter(
      b.effectId,
      b.emitterIndex,
      b.sourceDefinitionSha256,
    );
  }
}
const preparationMs = performance.now() - started,
  bursts = [...new Set(source.traces.map((t) => t.startTime))],
  frames = [],
  camera = source.camera;
const sampleFrame = (time, phase) => {
  const frame = {
      time,
      phase,
      elapsedMs: 0,
      quadMs: 0,
      trailMs: 0,
      samples: 0,
      particles: 0,
      draws: [],
    },
    pending = [],
    start = performance.now();
  for (const { name, runtime, bindings } of runtimes) {
    const begin = performance.now();
    runtime.beginFrame(time);
    for (const trace of source.traces) {
      if (
        time < trace.startTime ||
        trace.stopTime === null ||
        (time > trace.stopTime && !trace.renderParticlesAfterDestroy)
      )
        continue;
      for (const b of bindings) {
        if (b.effectId !== trace.effectId) continue;
        const sample = runtime.sample(trace, b.emitterIndex, time, camera);
        frame.samples++;
        if (sample) {
          frame.particles += sample.particleCount;
          pending.push({
            kind: name,
            sequence: trace.sequence,
            emitterIndex: b.emitterIndex,
            sample,
          });
        }
      }
    }
    frame[`${name}Ms`] = performance.now() - begin;
  }
  frame.elapsedMs = performance.now() - start;
  for (const { kind, sequence, emitterIndex, sample } of pending)
    frame.draws.push({
      kind,
      sequence,
      emitterIndex,
      particleCount: sample.particleCount,
      graphSha256: sample.graphSha256,
      geometrySha256: sha(
        new TextEncoder().encode(JSON.stringify(sample.geometry)),
      ),
    });
  frames.push(frame);
};
try {
  for (const burst of bursts) {
    for (let tick = -1; tick <= 36; tick++)
      sampleFrame(burst + tick / 60, "forward");
    for (const tick of [5, 5, 9, 2, 12, 30])
      sampleFrame(burst + tick / 60, "seek");
  }
} finally {
  for (const { runtime } of runtimes) runtime.close();
}
const values = frames.map((f) => f.elapsedMs).sort((a, b) => a - b),
  sources = {};
for (const name of [
  "latest-particle-playback.mjs",
  "latest-quad-pool-playback.mjs",
  "latest-trail-playback.mjs",
  "latest-vfx-legacy-quads.mjs",
  "latest-vfx-spawn.mjs",
  "latest-vfx-bound-quads.mjs",
  "latest-trail-particles.mjs",
  "latest-vfx-control.mjs",
  "latest-unicorn-bulk.mjs",
  "tools/profile-particle-playback.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const result = {
  schema: 1,
  kind: "particle-playback-cpu-profile",
  label,
  bulkMemory: !!option,
  build: profile.clientVersion,
  inputs,
  sources,
  preparationMs,
  counts: {
    traces: source.traces.length,
    bursts: bursts.length,
    frames: frames.length,
    samples: frames.reduce((a, f) => a + f.samples, 0),
    maximumSimultaneousDraws: Math.max(...frames.map((f) => f.draws.length)),
  },
  timings: {
    medianMs: values[Math.floor(values.length * 0.5)],
    p95Ms: values[Math.floor(values.length * 0.95)],
    maxMs: values.at(-1),
    totalMs: values.reduce((a, b) => a + b, 0),
  },
  frames,
  scope: {
    actualPoolCompositor: true,
    replayTrajectories: true,
    fullBurstTraversal: true,
    geometryDigestingOutsideFrameTimer: true,
    sceneInputsSupplied: true,
    browserRun: false,
    gpuSubmission: false,
  },
};
await Bun.write(
  `${cache}/research/particle-profile-${label}.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    label,
    preparationMs,
    counts: result.counts,
    timings: result.timings,
    slowest: frames
      .toSorted((a, b) => b.elapsedMs - a.elapsedMs)
      .slice(0, 4)
      .map(({ draws, ...f }) => f),
  }),
);
