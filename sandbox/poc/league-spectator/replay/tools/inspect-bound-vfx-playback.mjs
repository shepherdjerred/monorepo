// Exercise replay composition without a browser or graphics context.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLatestVfxBoundPlayback,
  sampleLatestBoundVfxDraws,
} from "../latest-vfx-bound-playback.mjs";
import { createLatestVfxSamplers } from "../latest-vfx-samplers.mjs";
import { compileLatestVfxDefinition } from "../latest-vfx-simulation.mjs";
import {
  analyzeLatestMissiles,
  createLatestMissileMotion,
} from "../latest-missiles.mjs";
import { createLatestMissileInitialization } from "../latest-missile-initialization.mjs";
import { createLatestMissileControllers } from "../latest-missile-controllers.mjs";
import { createLatestMissileFrame } from "../latest-missile-frame.mjs";
import { createLatestMissileActors } from "../latest-missile-actors.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { bindLatestMissileEffects } from "../latest-effects.mjs";
import { buildLatestMissilePlayback } from "../latest-missile-playback.mjs";

const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: inspect-bound-vfx-playback.mjs <cache>");
const cache = resolve(cacheArg),
  decoder = `${cache}/public/decoder-16.21-macos`,
  effects = `${cache}/public/latest-effects`,
  scene = `${cache}/public/latest-scene`;
const digest = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  inputs = {};
const bytes = async (path) => {
  const value = new Uint8Array(await Bun.file(path).arrayBuffer());
  inputs[path] = digest(value);
  return value;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await bytes(path)));
const report = await read(`${cache}/research/latest-semantics.json`),
  exportedAnalysis = await read(
    `${cache}/research/latest-missile-evidence.json`,
  );
const profile = await read(`${decoder}/profile.json`),
  manifest = await read(`${scene}/manifest.json`),
  effectBytes = await bytes(`${effects}/manifest.json`);
const effectManifest = JSON.parse(new TextDecoder().decode(effectBytes));
if (
  exportedAnalysis.semanticsSha256 !==
    inputs[`${cache}/research/latest-semantics.json`] ||
  exportedAnalysis.sceneManifestSha256 !== inputs[`${scene}/manifest.json`] ||
  effectManifest.sceneManifestSha256 !== exportedAnalysis.sceneManifestSha256 ||
  report.decoderImageSha256 !== profile.decoderImageSha256 ||
  report.build !== profile.clientVersion ||
  exportedAnalysis.protocol !== profile.protocolDigest ||
  manifest.protocol !== profile.protocolDigest
)
  throw Error("Replay composition input build/manifest mismatch");
const definitions = {};
for (const [name, key] of [
  ["missile-motion", "missileMotionSha256"],
  ["missile-controllers", "missileControllersSha256"],
  ["missile-actors", "missileActorsSha256"],
  ["vfx-samplers", "vfxSamplersSha256"],
]) {
  definitions[name] = await read(`${decoder}/${name}.json`);
  if (inputs[`${decoder}/${name}.json`] !== profile[key])
    throw Error(`Composition input integrity mismatch: ${name}`);
}
const terrain = createLatestTerrain(
  manifest,
  new Float32Array((await bytes(`${scene}/heights.bin`)).buffer),
);
const frame = createLatestMissileFrame(
  definitions["missile-controllers"],
  createLatestMissileMotion(definitions["missile-motion"]),
  createLatestMissileControllers(definitions["missile-controllers"]),
  terrain,
);
const subjects = [];
for (const hero of report.heroes) {
  const asset =
    manifest.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`];
  if (!asset) throw Error("Viewer-path missile owner has no prepared skin");
  subjects.push({
    entityId: hero.entityId,
    character: hero.champion,
    catalog: await read(`${scene}/${asset.spellCatalog}`),
  });
}
const actors = createLatestMissileActors(definitions["missile-actors"]),
  analysis = analyzeLatestMissiles(
    report,
    subjects,
    definitions["missile-motion"],
    {
      manifest,
      terrain,
      frame,
      actors,
      controllers: createLatestMissileControllers(
        definitions["missile-controllers"],
      ),
      initialization: createLatestMissileInitialization(
        definitions["missile-controllers"],
      ),
    },
  );
// Exercise the same direct producer-to-consumer contract as latest-viewer.mjs.
// The offline export adds provenance fields and must not supply missing runtime metadata.
for (const key of ["build", "protocol", "records", "eventIndex", "summary"])
  if (JSON.stringify(analysis[key]) !== JSON.stringify(exportedAnalysis[key]))
    throw Error(
      `Direct viewer analysis differs from exported evidence: ${key}`,
    );
const playback = buildLatestMissilePlayback(
  analysis,
  bindLatestMissileEffects(report, effectManifest),
  frame,
  actors,
  report.endTime,
);
const compiled = new Map(),
  samplers = createLatestVfxSamplers(definitions["vfx-samplers"]);
for (const trace of playback.traces) {
  if (compiled.has(trace.effectId)) continue;
  const ref = effectManifest.definitions[trace.effectId],
    record = await read(`${effects}/${ref.file}`);
  if (
    inputs[`${effects}/${ref.file}`] !== ref.sha256 ||
    ref.sha256 !== trace.effect.definitionSha256
  )
    throw Error("Composition effect changed");
  compiled.set(
    trace.effectId,
    compileLatestVfxDefinition(record, effectManifest, samplers),
  );
}
const runtimeFile = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
if (
  digest(await bytes(runtimeFile)) !==
  "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716"
)
  throw Error("Composition WASM runtime changed");
const { default: createUnicorn } = await import(
  pathToFileURL(runtimeFile).href
);
const runtime = await createLatestVfxBoundPlayback({
  uc: await createUnicorn(),
  profile,
  image: await bytes(`${decoder}/image.bin`),
  spawnBytes: await bytes(`${decoder}/vfx-spawn.json`),
  emitterBytes: await bytes(`${decoder}/vfx-emitter.json`),
  postloadBytes: await bytes(`${decoder}/vfx-postload.json`),
  definitionBytes: await bytes(`${decoder}/vfx-bound-quads.json`),
  effectsManifestBytes: effectBytes,
  loadGraphBytes: (path) => bytes(`${decoder}/${path}`),
  captureEvidence: true,
});
const supported = playback.traces.filter(
  (trace) => compiled.get(trace.effectId).supported.length,
);
if (!supported.length) throw Error("No replay-backed complete emitter inputs");
for (const [effectId, definition] of compiled)
  for (const emitter of definition.supported)
    await runtime.bindEmitter(
      effectId,
      emitter,
      effectManifest.definitions[effectId].sha256,
    );
const camera = {
  position: [12000, 12000, 0],
  right: [1, 0, 0],
  up: [0, 0, 1],
  axis: [0, 1, 0],
};
const times = [
  ...new Set([
    0,
    report.endTime,
    ...supported.flatMap((trace) =>
      [-0.001, 0, 0.001, 0.05, 0.15, 0.35, 0.8, 1.5].map(
        (age) => trace.startTime + age,
      ),
    ),
  ]),
]
  .filter((time) => time >= 0 && time <= report.endTime)
  .sort((a, b) => a - b);
const snapshots = [],
  timings = [],
  drawsByTime = [];
let seekChecks = 0;
try {
  for (const [index, time] of times.entries()) {
    const begin = performance.now(),
      draws = sampleLatestBoundVfxDraws(
        playback,
        compiled,
        time,
        runtime,
        camera,
      );
    timings.push(performance.now() - begin);
    snapshots.push({
      time,
      particles: draws.length,
      drawDataSha256: digest(JSON.stringify(draws)),
    });
    if (
      draws.length &&
      drawsByTime.length < 6 &&
      time >= supported[0].startTime + 0.05
    )
      drawsByTime.push({ time, draws });
    if (index % 25 === 0)
      console.log(
        JSON.stringify({
          forward: index,
          total: times.length,
          particles: draws.length,
        }),
      );
  }
  // Reverse queries interleave emitters and return to earlier checkpoints.
  for (const snapshot of [...snapshots].reverse()) {
    const draws = sampleLatestBoundVfxDraws(
      playback,
      compiled,
      snapshot.time,
      runtime,
      camera,
    );
    if (digest(JSON.stringify(draws)) !== snapshot.drawDataSha256)
      throw Error(`Complete-graph seek differs at ${snapshot.time}`);
    seekChecks++;
  }
  const sources = {};
  for (const name of [
    "latest-vfx-bound-playback.mjs",
    "latest-vfx-bound-quads.mjs",
    "latest-vfx-legacy-quads.mjs",
    "latest-vfx-spawn.mjs",
    "latest-vfx-emitter.mjs",
    "native-decoder.mjs",
    "latest-vfx-quad-vertices.mjs",
    "latest-vfx-simulation.mjs",
    "latest-missile-playback.mjs",
    "latest-missiles.mjs",
    "latest-missile-controllers.mjs",
    "latest-missile-initialization.mjs",
    "latest-terrain.mjs",
    "latest-missile-frame.mjs",
    "latest-missile-actors.mjs",
    "latest-vfx-samplers.mjs",
  ])
    sources[name] = digest(
      await Bun.file(resolve(import.meta.dir, "..", name)).arrayBuffer(),
    );
  const samples = runtime.evidenceSamples;
  const result = {
    schema: 1,
    kind: "complete-quad-replay-composition",
    build: report.build,
    protocol: report.protocol,
    inspectorSha256: digest(await Bun.file(import.meta.path).arrayBuffer()),
    sources,
    inputs,
    camera,
    runtime: runtime.summary,
    traces: supported,
    compiled: [...compiled].map(([effectId, definition]) => ({
      effectId,
      emitters: definition.supported.map((emitter) => emitter.index),
    })),
    counts: {
      traces: supported.length,
      graphs: new Set(samples.map((s) => s.graphSha256)).size,
      samples: samples.length,
      snapshots: snapshots.length,
      seekChecks,
      nativeInputFrames: samples.reduce(
        (total, sample) => total + sample.inputs.length,
        0,
      ),
    },
    samples,
    snapshots,
    drawsByTime,
    timings,
    scope: {
      fullUnchangedAssetGraphs: true,
      suppliedClock: "60 Hz plus fractional display update",
      suppliedSeed: "zero",
      suppliedQuality: 0,
      suppliedActorBasis: "local Y follows flight; local Z up",
      activationAtMissileStart: true,
      sceneInputsRecovered: false,
      browserRun: false,
      mainViewerIntegrated: false,
      nativeHostMathCompared: false,
      shaderPixelsCompared: false,
      leagueReferenceCompared: false,
    },
  };
  await Bun.write(
    `${cache}/research/bound-vfx-playback.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({ counts: result.counts, runtime: result.runtime }),
  );
} finally {
  runtime.close();
}
