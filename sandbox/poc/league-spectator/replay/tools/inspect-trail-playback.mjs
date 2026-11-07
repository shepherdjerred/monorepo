// Exercise the actual trail compositor on decoded replay missile trajectories.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual as equal } from "node:util";
import { createLatestTrailPlayback } from "../latest-trail-playback.mjs";
import { boundPlaybackInput } from "../latest-vfx-bound-playback.mjs";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: inspect-trail-playback.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  decoder = `${assets}/decoder-16.21-macos`,
  directory = `${assets}/latest-trail-particles`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  inputs = {},
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  profile = await read(`${decoder}/profile.json`),
  meta = await read(`${directory}/package.json`),
  source = await read(`${cache}/research/bound-vfx-playback.json`),
  nativeSource = await read(`${cache}/research/bound-vfx-playback-native.json`);
if (
  nativeSource.playbackSha256 !==
    inputs[`${cache}/research/bound-vfx-playback.json`] ||
  nativeSource.counts.mismatches !== 0 ||
  source.build !== profile.clientVersion
)
  throw Error("Unmatched replay trajectory evidence");
for (const [name, h] of Object.entries(source.sources))
  if (sha(await raw(`${root}/${name}`)) !== h)
    throw Error(`Replay trajectory source changed: ${name}`);
const { default: createUnicorn } = await import(
    pathToFileURL(`${assets}/vendor/unicorn_x86_candidate.mjs`).href
  ),
  bulkPackageBytes = await raw(`${assets}/latest-unicorn-bulk/package.json`),
  bulkPackage = JSON.parse(new TextDecoder().decode(bulkPackageBytes)),
  uc = await createLatestBulkUnicorn(
    createUnicorn,
    await raw(`${assets}/vendor/unicorn_x86_candidate.mjs`),
    bulkPackageBytes,
    await raw(`${assets}/latest-unicorn-bulk/${bulkPackage.file}`),
  ),
  runtime = await createLatestTrailPlayback({
    uc,
    profile,
    image: await raw(`${decoder}/image.bin`),
    spawnBytes: await raw(`${decoder}/vfx-spawn.json`),
    emitterBytes: await raw(`${decoder}/vfx-emitter.json`),
    boundBytes: await raw(`${decoder}/vfx-bound-quads.json`),
    packageBytes: await raw(`${directory}/package.json`),
    controlBytes: await raw(`${assets}/latest-vfx-control/package.json`),
    loadGraphBytes: (path) => raw(`${directory}/${path}`),
    captureEvidence: true,
  }),
  camera = {
    position: [12000, 12000, 0],
    right: [1, 0, 0],
    up: [0, 0, 1],
    axis: [0, 1, 0],
  },
  traces = [source.traces[0], source.traces.at(-1)],
  refs = meta.templates.filter((r) =>
    traces.some((t) => t.effectId === r.effectId),
  ),
  observations = [],
  snapshots = [],
  timings = [];
if (refs.length !== 3 || traces.length !== 2)
  throw Error("Unexpected replay trail cohort");
for (const r of refs)
  await runtime.bindEmitter(
    r.effectId,
    r.emitterIndex,
    r.sourceDefinitionSha256,
  );
const capture = (trace, ref, age) => {
  const time = trace.startTime + age,
    start = performance.now(),
    actual = runtime.sample(trace, ref.emitterIndex, time, camera),
    ms = performance.now() - start;
  timings.push(ms);
  return { trace, ref, time, age, actual };
};
try {
  for (const trace of traces)
    for (const age of [0.05, 0.1, 0.2, 0.35, 0.75, 1.25])
      for (const ref of refs) {
        const observation = capture(trace, ref, age);
        observations.push(observation);
        snapshots.push(observation);
      }
  for (const saved of [...snapshots].reverse()) {
    const actual = capture(saved.trace, saved.ref, saved.age);
    if (!equal(actual.actual, saved.actual))
      throw Error("Trail reverse seek changed geometry");
  }
} finally {
  runtime.close();
}
// Export complete canonical histories for independent native resimulation.
for (const sample of observations) {
  const { trace, ref } = sample,
    target = Math.fround(sample.age),
    stop = Math.fround(trace.stopTime - trace.startTime);
  let previous = 0,
    tick = 0,
    suspended = stop === 0;
  const history = [
    {
      input: boundPlaybackInput(trace, 0, 0, camera, ref.hasMultDefinition),
      suspended,
    },
  ];
  while (previous < target) {
    let next = Math.min(Math.fround((tick + 1) / 60), target);
    if (!suspended && stop > previous) next = Math.min(next, stop);
    if (next >= stop) suspended = true;
    history.push({
      input: boundPlaybackInput(
        trace,
        next,
        previous,
        camera,
        ref.hasMultDefinition,
      ),
      suspended,
    });
    previous = next;
    if (next === Math.fround((tick + 1) / 60)) tick++;
  }
  sample.history = history;
}
const sources = {};
for (const name of [
  "latest-trail-playback.mjs",
  "latest-particle-playback.mjs",
  "latest-trail-particles.mjs",
  "latest-vfx-control.mjs",
  "latest-unicorn-bulk.mjs",
  "latest-vfx-bound-playback.mjs",
  "latest-missile-playback.mjs",
  "tools/inspect-trail-playback.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
await Bun.write(
  `${cache}/research/trail-playback.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "replay-trail-composition-observation",
      build: profile.clientVersion,
      protocol: profile.protocolDigest,
      packageSha256: inputs[`${directory}/package.json`],
      inputs,
      sources,
      camera,
      traces,
      observations,
      counts: {
        traces: traces.length,
        emitters: refs.length,
        samples: observations.length,
        reverseSeekChecks: snapshots.length,
      },
      timings: {
        maxMs: Math.max(...timings),
        totalMs: timings.reduce((a, b) => a + b, 0),
      },
      scope: {
        replayTrajectories: true,
        stopSuspensionIsPreviewPolicy: true,
        sceneInputsSupplied: true,
        nativeCompared: false,
        browserRun: false,
        mainViewerIntegrated: false,
        referenceCompared: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    samples: observations.length,
    reverseSeekChecks: snapshots.length,
    maxMs: Math.max(...timings),
    totalMs: timings.reduce((a, b) => a + b, 0),
  }),
);
