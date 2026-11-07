import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestAnimationWorldPoses } from "../latest-animation-world-poses.mjs";

const [cachePath] = process.argv.slice(2);
if (!cachePath)
  throw Error("Usage: bun compare-resource-world-poses.mjs <cache>");
const cache = resolve(cachePath),
  inputs = {};
const hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).arrayBuffer();
  inputs[path] = hash(bytes);
  return bytes;
}
const tools = import.meta.dir;
const nativeBytes = await raw(
  `${cache}/research/animation-graph-preparation-dispatch-native.json`,
);
const native = JSON.parse(new TextDecoder().decode(nativeBytes));
const root = `${cache}/public/decoder-16.21-macos`;
const profile = JSON.parse(
  new TextDecoder().decode(await raw(`${root}/profile.json`)),
);
const image = new Uint8Array(await raw(`${root}/image.bin`));
const definitions = await raw(`${root}/animation-world-poses.json`);
const meta = JSON.parse(new TextDecoder().decode(definitions));
const vendor = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
if (
  hash(await raw(vendor)) !== meta.runtimeSha256 ||
  native.build !== meta.build
)
  throw Error("Matching native world-pose runtime and build required");
const { default: createUnicorn } = await import(pathToFileURL(vendor).href);
const uc = await createUnicorn();
const kernel = await createLatestAnimationWorldPoses(
  uc,
  profile,
  image,
  await raw(`${root}/vfx-spawn.json`),
  definitions,
);
let samples = 0,
  jointPoses = 0,
  reversedSamples = 0;
const mismatches = [];
try {
  for (const c of native.cases) {
    if (c.boundary || !c.animationPoses?.scope.originalWorldPosePassExecuted)
      throw Error(
        "Completed original resource and world-pose observations required",
      );
    for (const [file, expected] of Object.entries(c.inputs))
      if (hash(await raw(file)) !== expected)
        throw Error(`Native input changed: ${file}`);
    for (const [name, expected] of Object.entries(c.sources))
      if (hash(await raw(`${tools}/${name}`)) !== expected)
        throw Error(`Native producer changed: ${name}`);
    const graphs = Object.entries(meta.graphs).filter(
      ([, g]) => g.actor === c.actor,
    );
    if (graphs.length !== 1)
      throw Error("One exact prepared world-pose rig required");
    const [key, graph] = graphs[0],
      poses = c.animationPoses;
    if (
      JSON.stringify(graph.joints) !==
        JSON.stringify(poses.joints.map((j) => j.name)) ||
      JSON.stringify(graph.parents) !==
        JSON.stringify(poses.joints.map((j) => j.parent))
    )
      throw Error("Loaded and prepared world-pose rigs differ");
    const bound = await kernel.bind(
      key,
      await raw(`${cache}/public/latest-scene/${graph.rigFile}`),
      await raw(`${cache}/public/latest-scene/${graph.catalogFile}`),
    );
    const work = poses.resources.flatMap((resource, resourceIndex) =>
      resource.samples.map((sample, index) => ({
        resource,
        resourceIndex,
        sample,
        index,
      })),
    );
    for (const reverse of [false, true]) {
      for (const { resource, resourceIndex, sample, index } of reverse
        ? [...work].reverse()
        : work) {
        if (
          !resource.completed ||
          !sample.worldValid ||
          sample.worldRevision !== 1 ||
          !sample.worldCachedCallUnchanged
        )
          throw Error(
            "Complete native world-pose validity and cached-call checks required",
          );
        const local = sample.localPosesHex.match(/.{80}/g);
        if (
          !local ||
          local.length !== poses.joints.length ||
          local.join("") !== sample.localPosesHex
        )
          throw Error("Bounded complete native local poses required");
        const actual = bound.sample(
          local,
          poses.worldPoseControl.rootHex,
          poses.worldPoseControl.inheritScale,
        );
        if (
          actual.worldHex.join("") !== sample.worldPosesHex ||
          !actual.worldValid ||
          actual.revision !== 1 ||
          actual.secondChanged
        )
          mismatches.push({
            actor: c.actor,
            resourceIndex,
            sample: index,
            reverse,
          });
        if (reverse) reversedSamples++;
        else {
          samples++;
          jointPoses += local.length;
        }
      }
    }
  }
} finally {
  kernel.close();
}
for (const name of [
  "latest-animation-world-poses.mjs",
  "latest-vfx-spawn.mjs",
  "native-decoder.mjs",
  "structural-comparison.mjs",
])
  await raw(`${tools}/../${name}`);
const result = {
  schema: 1,
  kind: "loaded-resource-world-pose-wasm-comparison",
  build: native.build,
  inputs,
  sourceSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  counts: {
    samples,
    jointPoses,
    comparedFloatLanes: jointPoses * 10,
    reversedSamples,
  },
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 10),
  scope: {
    originalWorldPassCompared: true,
    nativeAnmEvaluatorRunsInBrowser: false,
    controlledIdentityRoot: true,
    recordedWorldPlacement: false,
    animationGraphBlending: false,
    mainViewerExpanded: false,
  },
};
const output = `${cache}/research/resource-world-poses-comparison.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    counts: result.counts,
    mismatchCount: result.mismatchCount,
  }),
);
if (mismatches.length) process.exitCode = 1;
