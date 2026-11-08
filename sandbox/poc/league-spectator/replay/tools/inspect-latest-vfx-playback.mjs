// Data/asset inspection of the browser's actual preview compiler and draw sampler.
// This does not execute WebGL or compare against League's rendered presentation.
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { cpus } from "node:os";
import { createLatestVfxUvPlayback } from "../latest-vfx-uv-playback.mjs";
import { createLatestVfxLifecyclePlayback } from "../latest-vfx-lifecycle-playback.mjs";
import {
  createLatestVfxSamplers,
  latestVfxTextureKey,
} from "../latest-vfx-samplers.mjs";
import { createLatestMissileMotion } from "../latest-missiles.mjs";
import { createLatestMissileControllers } from "../latest-missile-controllers.mjs";
import { createLatestMissileFrame } from "../latest-missile-frame.mjs";
import { createLatestMissileActors } from "../latest-missile-actors.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { bindLatestMissileEffects } from "../latest-effects.mjs";
import {
  buildLatestMissilePlayback,
  sampleLatestMissileTrace,
} from "../latest-missile-playback.mjs";
import {
  compileLatestVfxDefinition,
  sampleLatestVfxDraws,
} from "../latest-vfx-simulation.mjs";

const [
  reportPath,
  analysisPath,
  decoderPath,
  scenePath,
  effectsPath,
  outputPath,
] = process.argv.slice(2);
const profileOnly = process.argv[8] === "--profile-only";
if (process.argv[8] && !profileOnly) throw Error("Unknown VFX inspection mode");
if (!outputPath)
  throw Error(
    "Usage: bun inspect-latest-vfx-playback.mjs <semantics> <missile-analysis> <decoder> <scene> <effects> <evidence>",
  );
const decoder = resolve(decoderPath),
  scene = resolve(scenePath),
  effects = resolve(effectsPath),
  profile = await Bun.file(`${decoder}/profile.json`).json(),
  reportBytes = await Bun.file(reportPath).arrayBuffer(),
  analysisBytes = await Bun.file(analysisPath).arrayBuffer(),
  sceneBytes = await Bun.file(`${scene}/manifest.json`).arrayBuffer(),
  heights = await Bun.file(`${scene}/heights.bin`).arrayBuffer(),
  effectBytes = await Bun.file(`${effects}/manifest.json`).arrayBuffer(),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  decode = (b) => JSON.parse(new TextDecoder().decode(b)),
  report = decode(reportBytes),
  analysis = decode(analysisBytes),
  manifest = decode(sceneBytes),
  effectManifest = decode(effectBytes);
if (
  analysis.semanticsSha256 !== hash(reportBytes) ||
  analysis.sceneManifestSha256 !== hash(sceneBytes) ||
  analysis.missileControllersSha256 !== profile.missileControllersSha256 ||
  analysis.missileActorsSha256 !== profile.missileActorsSha256 ||
  analysis.missileMotionSha256 !== profile.missileMotionSha256 ||
  report.decoderImageSha256 !== profile.decoderImageSha256 ||
  report.constructorImageSha256 !== profile.constructorImageSha256 ||
  effectManifest.sceneManifestSha256 !== hash(sceneBytes) ||
  report.fieldCodecsSha256 !== profile.fieldCodecsSha256 ||
  report.build !== manifest.build ||
  manifest.build !== profile.clientVersion ||
  effectManifest.build !== manifest.build ||
  report.protocol !== manifest.protocol ||
  manifest.protocol !== profile.protocolDigest ||
  effectManifest.protocol !== manifest.protocol
)
  throw Error("VFX playback package mismatch");
const data = {};
for (const [name, key] of [
  ["missile-motion", "missileMotionSha256"],
  ["missile-controllers", "missileControllersSha256"],
  ["missile-actors", "missileActorsSha256"],
  ["vfx-values", "vfxValuesSha256"],
  ["vfx-samplers", "vfxSamplersSha256"],
]) {
  const bytes = await Bun.file(`${decoder}/${name}.json`).arrayBuffer();
  if (hash(bytes) !== profile[key])
    throw Error(`VFX playback definition mismatch: ${name}`);
  data[name] = decode(bytes);
}
const terrain = createLatestTerrain(manifest, new Float32Array(heights)),
  controllers = createLatestMissileControllers(data["missile-controllers"]),
  frame = createLatestMissileFrame(
    data["missile-controllers"],
    createLatestMissileMotion(data["missile-motion"]),
    controllers,
    terrain,
  ),
  actors = createLatestMissileActors(data["missile-actors"]),
  samplers = createLatestVfxSamplers(data["vfx-samplers"]),
  playback = buildLatestMissilePlayback(
    analysis,
    bindLatestMissileEffects(report, effectManifest),
    frame,
    actors,
    report.endTime,
  ),
  definitions = new Map(),
  files = new Map(),
  textureStates = new Map();
const vendor = resolve(dirname(decoder), "vendor");
const uvDefinitionBytes = await Bun.file(
  `${decoder}/vfx-uv-animation.json`,
).arrayBuffer();
const uvMeta = decode(uvDefinitionBytes);
if (
  hash(await Bun.file(`${vendor}/unicorn_x86_candidate.mjs`).arrayBuffer()) !==
  uvMeta.runtimeSha256
)
  throw Error("UV playback runtime hash mismatch");
const { default: createUnicorn } = await import(
  pathToFileURL(`${vendor}/unicorn_x86_candidate.mjs`).href
);
const uc = await createUnicorn(),
  image = new Uint8Array(await Bun.file(`${decoder}/image.bin`).arrayBuffer()),
  lifecyclePlayback = await createLatestVfxLifecyclePlayback({
    uc,
    profile,
    image,
    spawnBytes: await Bun.file(`${decoder}/vfx-spawn.json`).arrayBuffer(),
    emitterBytes: await Bun.file(`${decoder}/vfx-emitter.json`).arrayBuffer(),
    definitionBytes: await Bun.file(
      `${decoder}/vfx-legacy-quads.json`,
    ).arrayBuffer(),
    effectsManifestBytes: effectBytes,
    loadGraphBytes: (path) => Bun.file(`${decoder}/${path}`).arrayBuffer(),
    captureEvidence: !profileOnly,
  });
const uvPlayback = await createLatestVfxUvPlayback({
  uc,
  profile,
  image,
  definitionBytes: uvDefinitionBytes,
  effectsManifestBytes: effectBytes,
  loadGraphBytes: (path) => Bun.file(`${decoder}/${path}`).arrayBuffer(),
});
for (const trace of playback.traces) {
  if (definitions.has(trace.effectId)) continue;
  const entry = effectManifest.definitions[trace.effectId],
    bytes = await Bun.file(`${effects}/${entry.file}`).arrayBuffer();
  if (hash(bytes) !== entry.sha256) throw Error("VFX definition changed");
  const compiled = compileLatestVfxDefinition(
    decode(bytes),
    effectManifest,
    samplers,
  );
  definitions.set(trace.effectId, compiled);
  files.set(entry.file, entry.sha256);
  for (const emitter of compiled.supported)
    for (const [asset, sampler] of [
      [emitter.texture, emitter.baseSampler],
      [emitter.multTexture, emitter.multSampler],
    ].filter(([asset]) => asset))
      textureStates.set(latestVfxTextureKey(asset, sampler), {
        file: asset.file,
        sampler,
      });
  for (const emitter of compiled.supported)
    await uvPlayback.bindEmitter(trace.effectId, emitter, entry.sha256);
  for (const emitter of compiled.supported)
    await lifecyclePlayback.bindEmitter(trace.effectId, emitter, entry.sha256);
  for (const emitter of compiled.supported)
    for (const asset of [emitter.texture, emitter.multTexture].filter(
      Boolean,
    )) {
      if (files.has(asset.file)) continue;
      if (
        hash(await Bun.file(`${effects}/${asset.file}`).arrayBuffer()) !==
        asset.sha256
      )
        throw Error("VFX texture changed");
      files.set(asset.file, asset.sha256);
    }
}
const first = playback.traces.find(
  (t) => definitions.get(t.effectId).supported.length,
);
if (!first)
  throw Error("No deterministic emitter in the admitted playback subset");
if (profileOnly) {
  const passes = [];
  for (let pass = 0; pass < 3; pass++) {
    const samples = [];
    for (let i = 0; i <= 24; i++) {
      const time = first.startTime + i / 60,
        begin = performance.now(),
        draws = sampleLatestVfxDraws(
          playback,
          definitions,
          time,
          uvPlayback,
          lifecyclePlayback,
        );
      samples.push({
        time,
        particles: draws.length,
        milliseconds: performance.now() - begin,
        checkpointBytes: lifecyclePlayback.summary.checkpointBytes,
      });
    }
    passes.push({ pass, samples });
  }
  const sources = {};
  for (const name of [
    "latest-vfx-lifecycle-playback.mjs",
    "latest-vfx-legacy-quads.mjs",
    "latest-vfx-spawn.mjs",
    "latest-vfx-simulation.mjs",
    "latest-vfx-uv-animation.mjs",
    "latest-vfx-uv-playback.mjs",
    "latest-vfx-quad-vertices.mjs",
  ])
    sources[name] = hash(
      await Bun.file(new URL(`../${name}`, import.meta.url)).arrayBuffer(),
    );
  await Bun.write(
    outputPath,
    JSON.stringify(
      {
        schema: 1,
        kind: "vfx-runtime-profile",
        build: report.build,
        protocol: report.protocol,
        reportSha256: hash(reportBytes),
        analysisSha256: hash(analysisBytes),
        sceneManifestSha256: hash(sceneBytes),
        heightBytesSha256: hash(heights),
        effectManifestSha256: hash(effectBytes),
        runtimeSha256: uvMeta.runtimeSha256,
        definitionHashes: Object.fromEntries(
          [
            "vfxSpawnSha256",
            "vfxEmitterSha256",
            "vfxLegacyQuadsSha256",
            "vfxUvAnimationSha256",
            "vfxSamplersSha256",
          ].map((n) => [n, profile[n]]),
        ),
        host: {
          bun: Bun.version,
          platform: process.platform,
          arch: process.arch,
          cpuModels: [...new Set(cpus().map((c) => c.model))],
          logicalCpuCount: cpus().length,
        },
        sources,
        inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
        passes,
        scope:
          "Three Bun CLI passes over 25 consecutive supplied 60 Hz draw times using the browser's exact WASM lifecycle/UV/draw sampler with diagnostic capture disabled. First pass includes cold native code/instance preparation; later passes recreate instances with warm code/static-graph/UV caches. Excludes browser execution, WebGL, GPU, scheduling, asset transfer and initial package load. Not a browser frame-rate measurement or League fidelity comparison.",
      },
      null,
      2,
    ),
  );
  uvPlayback.close();
  lifecyclePlayback.close();
  console.log(
    JSON.stringify({
      kind: "vfx-runtime-profile",
      passes: passes.length,
      samples: passes.reduce((n, p) => n + p.samples.length, 0),
    }),
  );
  process.exit(0);
}
const times = [
    ...new Set([
      0,
      report.endTime,
      ...playback.traces.flatMap((trace) => [
        ...[-0.01, 0.001, 0.05, 0.08, 0.15, 0.2, 0.35].map(
          (delta) => trace.startTime + delta,
        ),
        ...(trace.stopTime === null
          ? []
          : [-0.001, 0, 0.001, 0.2].map((delta) => trace.stopTime + delta)),
      ]),
    ]),
  ]
    .filter((time) => time >= 0 && time <= report.endTime)
    .sort((a, b) => a - b),
  snapshots = [],
  uvSamples = new Map(),
  quadSamples = new Map();
const timingSamples = [];
for (const time of times) {
  const begin = performance.now();
  const draws = sampleLatestVfxDraws(
    playback,
    definitions,
    time,
    uvPlayback,
    lifecyclePlayback,
  );
  timingSamples.push({
    time,
    particles: draws.length,
    milliseconds: performance.now() - begin,
  });
  for (const draw of draws)
    quadSamples.set(
      hash(JSON.stringify(draw.nativeQuad.input)),
      draw.nativeQuad,
    );
  for (const draw of draws)
    uvSamples.set(
      `${draw.uvTransforms.graphSha256}:${Math.fround(draw.age)}:${Math.fround(draw.life)}`,
      {
        graphSha256: draw.uvTransforms.graphSha256,
        age: draw.age,
        life: draw.life,
        uv: draw.uvTransforms,
      },
    );
  for (const draw of draws)
    if (
      ![
        ...draw.positions.flat(),
        ...draw.uv.flat(),
        ...draw.multUv.flat(),
        ...draw.color,
        ...draw.uvTransforms.base,
        ...draw.uvTransforms.mult,
      ].every(Number.isFinite)
    )
      throw Error("Nonfinite VFX draw data");
  snapshots.push({
    time,
    particles: draws.length,
    missiles: new Set(draws.map((d) => d.entityId)).size,
    drawDataSha256: hash(JSON.stringify(draws)),
  });
}
let seekSamples = 0;
for (const time of [...times].reverse()) {
  const actual = hash(
    JSON.stringify(
      sampleLatestVfxDraws(
        playback,
        definitions,
        time,
        uvPlayback,
        lifecyclePlayback,
      ),
    ),
  );
  if (actual !== snapshots.find((s) => s.time === time).drawDataSha256)
    throw Error("VFX seek order changed draw state");
  seekSamples++;
}
const sources = Object.fromEntries(
  await Promise.all(
    [
      "latest-missile-playback.mjs",
      "latest-vfx-values.mjs",
      "latest-vfx-simulation.mjs",
      "latest-vfx-renderer.mjs",
      "latest-vfx-uv-animation.mjs",
      "latest-vfx-uv-playback.mjs",
      "latest-vfx-samplers.mjs",
      "latest-vfx-quad-vertices.mjs",
      "latest-vfx-lifecycle-playback.mjs",
      "latest-vfx-legacy-quads.mjs",
      "latest-vfx-spawn.mjs",
      "latest-vfx-emitter.mjs",
    ].map(async (name) => [
      name,
      hash(
        await Bun.file(new URL(`../${name}`, import.meta.url)).arrayBuffer(),
      ),
    ]),
  ),
);
const drawTime = first.startTime + 0.08,
  draws = sampleLatestVfxDraws(
    playback,
    definitions,
    drawTime,
    uvPlayback,
    lifecyclePlayback,
  ),
  center = sampleLatestMissileTrace(first, drawTime).position;
const runtimePlayback = await createLatestVfxLifecyclePlayback({
  uc,
  profile,
  image,
  spawnBytes: await Bun.file(`${decoder}/vfx-spawn.json`).arrayBuffer(),
  emitterBytes: await Bun.file(`${decoder}/vfx-emitter.json`).arrayBuffer(),
  definitionBytes: await Bun.file(
    `${decoder}/vfx-legacy-quads.json`,
  ).arrayBuffer(),
  effectsManifestBytes: effectBytes,
  loadGraphBytes: (path) => Bun.file(`${decoder}/${path}`).arrayBuffer(),
});
for (const [effectId, definition] of definitions)
  for (const emitter of definition.supported)
    await runtimePlayback.bindEmitter(
      effectId,
      emitter,
      effectManifest.definitions[effectId].sha256,
    );
const runtimeTimings = [];
for (let i = 0; i <= 24; i++) {
  const time = first.startTime + i / 60,
    begin = performance.now(),
    sampled = sampleLatestVfxDraws(
      playback,
      definitions,
      time,
      uvPlayback,
      runtimePlayback,
    );
  runtimeTimings.push({
    time,
    particles: sampled.length,
    milliseconds: performance.now() - begin,
    checkpointBytes: runtimePlayback.summary.checkpointBytes,
  });
}
runtimePlayback.close();
const result = {
  schema: 1,
  build: report.build,
  protocol: report.protocol,
  reportSha256: hash(reportBytes),
  analysisSha256: hash(analysisBytes),
  effectManifestSha256: hash(effectBytes),
  vfxValuesSha256: profile.vfxValuesSha256,
  vfxSamplersSha256: profile.vfxSamplersSha256,
  textureStates: [...textureStates].map(([key, value]) => ({ key, ...value })),
  observerSourceSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  nativeUv: uvPlayback.summary,
  nativeUvSamples: [...uvSamples.values()],
  nativeQuad: { definitionSha256: profile.vfxQuadVerticesSha256 },
  nativeQuadSamples: [...quadSamples.values()],
  nativeLifecycle: lifecyclePlayback.summary,
  nativeLifecycleSamples: lifecyclePlayback.evidenceSamples,
  timingSamples,
  runtimeTimings,
  timingScope:
    "Bun CPU draw-sampling only using the same WASM adapter, with diagnostic capture enabled for timingSamples and disabled for runtimeTimings. Excludes browser/WebGL, frame scheduling, transfers and GPU work; not a browser frame-rate claim.",
  sources,
  summary: playback.summary,
  verifiedFiles: files.size,
  snapshots,
  seekSamples,
  compiled: [...definitions].map(([id, d]) => ({
    id,
    supported: d.supported.map((e) => ({
      index: e.index,
      name: e.emitter.emitterName,
    })),
    omitted: d.omitted,
    limitations: d.limitations,
  })),
  softwarePreview: { time: drawTime, center, draws },
  scope:
    "Actual browser preview compiler/clock/draw-data functions on decoded inputs, hashed definitions and textures. Finite geometry and seek-order stability checked; WebGL execution, visual appearance and League reference comparison not performed. Native numeric curve/flight evidence has separate scope",
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
uvPlayback.close();
lifecyclePlayback.close();
console.log(
  JSON.stringify({
    traces: playback.traces.length,
    effects: definitions.size,
    emitters: [...definitions.values()].reduce(
      (n, d) => n + d.supported.length,
      0,
    ),
    drawTime,
    particles: draws.length,
    verifiedFiles: files.size,
    seekSamples,
  }),
);
