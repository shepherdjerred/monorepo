import { resolve } from "node:path";
import { createLatestAnimationPoses } from "../latest-animation-poses.mjs";
import {
  createAnimationGraph,
  readAnimationAsset,
} from "../latest-animation.mjs";

const [packagePath, scenePath, posePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-animation-poses.mjs <decoder> <scene> <poses> <evidence>",
  );
const root = resolve(packagePath),
  scene = resolve(scenePath),
  poses = resolve(posePath),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  profile = await Bun.file(`${root}/profile.json`).json(),
  clockBytes = await Bun.file(`${root}/animation-clock.json`).arrayBuffer(),
  poseBytes = await Bun.file(`${poses}/manifest.json`).arrayBuffer(),
  meta = JSON.parse(new TextDecoder().decode(poseBytes)),
  clocks = JSON.parse(new TextDecoder().decode(clockBytes)),
  factory = await createLatestAnimationPoses(profile, clockBytes, poseBytes),
  observations = [],
  unresolvedReasons = {},
  mismatches = [],
  curves = [];
for (const [name, digest] of Object.entries(meta.toolchain.sources))
  if (
    hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
    digest
  )
    throw Error("Pose exporter source changed");
if (
  hash(
    await Bun.file(
      new URL("prepare-animation-poses.mjs", import.meta.url),
    ).arrayBuffer(),
  ) !== meta.toolchain.preparerSha256
)
  throw Error("Pose preparer source changed");
let values = 0,
  addedFrames = 0,
  affectedClips = 0,
  graphLeaves = 0,
  unresolvedLeaves = 0,
  clipNames = 0;
for (const [graphFile, source] of Object.entries(meta.graphs)) {
  const original = clocks.graphs[graphFile],
    oldCatalogBytes = await Bun.file(
      `${scene}/${original.catalogFile}`,
    ).arrayBuffer(),
    oldCatalog = JSON.parse(new TextDecoder().decode(oldCatalogBytes)),
    graphBytes = await Bun.file(`${scene}/${graphFile}`).arrayBuffer(),
    binding = await factory.bind(graphFile, graphBytes, oldCatalogBytes),
    graph = createAnimationGraph(
      JSON.parse(new TextDecoder().decode(graphBytes)),
      binding.catalog,
      binding.clock,
    ),
    seen = new Set();
  if (
    hash(await Bun.file(`${scene}/${source.rigFile}`).arrayBuffer()) !==
    source.rigSha256
  )
    throw Error("Pose skeleton source changed");
  for (const [name, entry] of Object.entries(binding.catalog.clips)) {
    clipNames++;
    const ref = original.clips[name],
      oldEntry = oldCatalog.clips[name];
    if (entry.frames > oldEntry.frames) affectedClips++;
    for (const elapsed of [0, ref.duration * 0.25, ref.duration * 0.75]) {
      const result = graph.evaluate(name, elapsed, { moving: false });
      unresolvedLeaves += result.unresolved.length;
      for (const item of result.unresolved)
        unresolvedReasons[item.reason] =
          (unresolvedReasons[item.reason] ?? 0) + 1;
      graphLeaves += result.leaves.length;
      for (const leaf of result.leaves)
        if (
          leaf.sourceFrame < 0 ||
          leaf.sourceFrame > entry.frames - 1 + 0.0001
        )
          throw Error("Atomic pose clock exceeds prepared resource frames");
    }
    if (!seen.has(entry.file)) {
      seen.add(entry.file);
      const oldBytes = await Bun.file(
          `${scene}/${source.directory}/${oldEntry.file}`,
        ).arrayBuffer(),
        newBytes = await Bun.file(
          `${poses}/${source.directory}/${entry.file}`,
        ).arrayBuffer(),
        old = readAnimationAsset(oldBytes),
        next = readAnimationAsset(newBytes),
        tracks = new Map(
          next.tracks.map((t) => [`${t.jointId}/${t.channel}`, t]),
        );
      if (
        hash(newBytes) !== binding.expectedFileHash(entry.file) ||
        next.frames !== ref.clock.resourceFrames ||
        old.frames > next.frames
      )
        throw Error("Pose payload frame/source contract mismatch");
      for (const a of old.tracks) {
        const b = tracks.get(`${a.jointId}/${a.channel}`);
        if (!b || a.bone !== b.bone || a.width !== b.width)
          throw Error("Pose track binding changed");
        const frames = a.count === 1 && b.count === 1 ? 1 : old.frames;
        for (let i = 0; i < frames; i++)
          for (let lane = 0; lane < a.width; lane++) {
            const x = a.values[(a.count === 1 ? 0 : i) * a.width + lane],
              y = b.values[(b.count === 1 ? 0 : i) * b.width + lane];
            values++;
            if (!Object.is(x, y)) {
              if (mismatches.length < 20)
                mismatches.push({
                  graphFile,
                  name,
                  track: a.bone,
                  channel: a.channel,
                  frame: i,
                  lane,
                  x,
                  y,
                });
              else throw Error("More than twenty changed prefix pose values");
            }
          }
      }
      const extra = next.frames - old.frames;
      addedFrames += extra;
      observations.push({
        graphFile,
        name,
        file: `${source.directory}/${entry.file}`,
        sha256: hash(newBytes),
        oldSha256: hash(oldBytes),
        oldFrames: old.frames,
        frames: next.frames,
        addedFrames: extra,
        sourceSha256: entry.sourceSha256,
        tracks: next.tracks.length,
      });
    }
    if (
      (source.actor === "champions/karthus/10" && name === "Run_Base") ||
      (source.actor === "champions/viego/43" && name === "Run_Homeguard_toRun")
    ) {
      curves.push({
        actor: source.actor,
        name,
        oldDuration: oldEntry.duration,
        oldFrames: oldEntry.frames,
        oldFps: oldEntry.fps,
        nativeDuration: ref.duration,
        samples: Array.from({ length: 121 }, (_, i) => {
          const elapsed = (Math.min(oldEntry.duration, ref.duration) * i) / 120,
            timing = binding.clock.evaluate(name, elapsed);
          return {
            elapsed,
            oldFrame: Math.min(oldEntry.frames - 1, elapsed * oldEntry.fps),
            nativeFrame: Math.fround(timing.poseTime * entry.fps),
            eventFrame: timing.frame,
          };
        }),
      });
    }
  }
}
const sources = {};
for (const name of [
  "latest-animation.mjs",
  "latest-animation-clock.mjs",
  "latest-animation-poses.mjs",
  "latest-viewer.mjs",
])
  sources[name] = hash(
    await Bun.file(new URL(`../${name}`, import.meta.url)).arrayBuffer(),
  );
const result = {
  schema: 1,
  build: meta.build,
  protocol: meta.protocol,
  definitionSha256: hash(clockBytes),
  poseManifestSha256: hash(poseBytes),
  sources,
  inspectorSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  graphs: Object.keys(meta.graphs).length,
  clipNames,
  assets: observations.length,
  affectedClips,
  addedFrames,
  comparedPrefixValues: values,
  graphLeaves,
  unresolvedLeaves,
  unresolvedReasons,
  mismatchCount: mismatches.length,
  mismatches,
  observations,
  curves,
  scope:
    "All prepared pose files have native resource frame coverage; existing sampled prefix values are compared exactly. Main graph clock/pose binding exercised via CLI. No browser/GPU or original League pose/A/V comparison is established.",
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    graphs: result.graphs,
    clipNames,
    assets: observations.length,
    affectedClips,
    addedFrames,
    comparedPrefixValues: values,
    graphLeaves,
    unresolvedLeaves,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) process.exitCode = 1;
