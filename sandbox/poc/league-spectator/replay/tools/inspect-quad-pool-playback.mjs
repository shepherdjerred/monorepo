// Observe the shared multi-particle quad compositor on decoded replay paths.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createLatestQuadPoolPlayback } from "../latest-quad-pool-playback.mjs";
import { boundPlaybackInput } from "../latest-vfx-bound-playback.mjs";
import { createLatestBulkUnicorn } from "../latest-unicorn-bulk.mjs";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: inspect-quad-pool-playback.mjs <cache>");
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
  profile = await read(`${decoder}/profile.json`),
  packageBytes = await raw(`${decoder}/vfx-bound-quads.json`),
  meta = JSON.parse(new TextDecoder().decode(packageBytes)),
  gpu = await read(`${assets}/latest-complete-quad-gpu/package.json`),
  replay = await read(`${cache}/research/bound-vfx-playback.json`),
  replayProof = await read(`${cache}/research/bound-vfx-playback-native.json`),
  traces = [replay.traces[0], replay.traces.at(-1)],
  keys = new Set(gpu.emitters.map((e) => `${e.effectId}:${e.emitterIndex}`)),
  refs = meta.templates.filter(
    (r) =>
      keys.has(`${r.effectId}:${r.emitterIndex}`) &&
      traces.some((t) => t.effectId === r.effectId),
  ),
  { default: createUnicorn } = await import(
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
  runtime = await createLatestQuadPoolPlayback({
    uc,
    profile,
    image: await raw(`${decoder}/image.bin`),
    spawnBytes: await raw(`${decoder}/vfx-spawn.json`),
    emitterBytes: await raw(`${decoder}/vfx-emitter.json`),
    postloadBytes: await raw(`${decoder}/vfx-postload.json`),
    packageBytes,
    controlBytes: await raw(`${assets}/latest-vfx-control/package.json`),
    loadGraphBytes: (p) => {
      if (p.startsWith("/") || p.includes(".."))
        throw Error("Invalid quad graph path");
      return raw(`${decoder}/${p}`);
    },
  }),
  camera = replay.camera,
  observations = [];
if (
  replayProof.playbackSha256 !==
    inputs[`${cache}/research/bound-vfx-playback.json`] ||
  replayProof.counts.mismatches !== 0 ||
  replay.build !== profile.clientVersion
)
  throw Error(
    "Quad pool playback requires matching native replay trajectory evidence",
  );
try {
  for (const ref of refs)
    await runtime.bindEmitter(
      ref.effectId,
      ref.emitterIndex,
      ref.sourceDefinitionSha256,
    );
  for (const trace of traces)
    for (const age of [0, 0.05, 0.1, 0.2, 0.35, 0.75, 1.25])
      for (const ref of refs) {
        const actual = runtime.sample(
          trace,
          ref.emitterIndex,
          trace.startTime + age,
          camera,
        );
        observations.push({ trace, ref, age, actual });
      }
  for (const saved of [...observations].reverse()) {
    const actual = runtime.sample(
      saved.trace,
      saved.ref.emitterIndex,
      saved.trace.startTime + saved.age,
      camera,
    );
    if (!isDeepStrictEqual(actual, saved.actual))
      throw Error("Reverse seek changed native quad pool geometry");
  }
} finally {
  runtime.close();
}
for (const sample of observations) {
  const { trace, ref, age } = sample,
    target = Math.fround(age),
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
    if (next <= previous) throw Error("Quad history clock did not advance");
    if (!suspended && next >= stop) suspended = true;
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
  "latest-quad-pool-playback.mjs",
  "latest-particle-playback.mjs",
  "latest-vfx-bound-quads.mjs",
  "latest-vfx-control.mjs",
  "latest-unicorn-bulk.mjs",
  "latest-vfx-bound-playback.mjs",
  "latest-missile-playback.mjs",
  "tools/inspect-quad-pool-playback.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const counts = {
  traces: traces.length,
  emitters: refs.length,
  samples: observations.length,
  reverseSeekChecks: observations.length,
  maximumPool: Math.max(
    ...observations.map((o) => o.actual?.particleCount ?? 0),
  ),
};
await Bun.write(
  `${cache}/research/quad-pool-playback.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "replay-quad-pool-composition-observation",
      build: profile.clientVersion,
      protocol: profile.protocolDigest,
      packageSha256: sha(packageBytes),
      inputs,
      sources,
      camera,
      traces,
      observations,
      counts,
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
console.log(JSON.stringify(counts));
