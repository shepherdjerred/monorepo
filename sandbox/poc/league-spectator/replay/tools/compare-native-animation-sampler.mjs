// Exercise the reusable sampler with interleaved stateful clips and reused buffers.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestNativeAnimationResources } from "../latest-native-animation-resources.mjs";
import { bindLatestNativeAnimationCatalog } from "../latest-native-animation-catalog.mjs";

const [cachePath] = process.argv.slice(2);
if (!cachePath)
  throw Error("Usage: bun compare-native-animation-sampler.mjs <cache>");
const cache = resolve(cachePath),
  inputs = {};
const hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
async function raw(path) {
  path = resolve(path);
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  inputs[path] = hash(bytes);
  return bytes;
}
const json = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
const native = await json(
  `${cache}/research/animation-graph-preparation-dispatch-native.json`,
);
const skin = await json(
  `${cache}/research/animation-skin-matrices-native.json`,
);
const prepared = await json(
  `${cache}/research/native-animation-package-evidence.json`,
);
if (
  native.cases.length !== 1 ||
  native.cases[0].boundary ||
  skin.boundary ||
  skin.actor !== native.cases[0].actor
)
  throw Error("Complete matching original native animation controls required");
for (const report of [native.cases[0], skin, prepared]) {
  for (const [path, expected] of Object.entries(report.inputs))
    if (hash(await raw(path)) !== expected)
      throw Error(`Native input changed: ${path}`);
  for (const [name, expected] of Object.entries(report.sources ?? {}))
    if (hash(await raw(`${import.meta.dir}/${name}`)) !== expected)
      throw Error(`Native producer changed: ${name}`);
}
if (
  hash(await raw(`${import.meta.dir}/publish-native-animation-package.py`)) !==
  prepared.sourceSha256
)
  throw Error("Native animation package producer changed");
const profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
const spawnBytes = await raw(
  `${cache}/public/decoder-16.21-macos/vfx-spawn.json`,
);
const manifestBytes = await raw(
  `${cache}/public/latest-native-animation-resources/manifest.json`,
);
const binaryBytes = await raw(
  `${cache}/public/latest-native-animation-resources/static.bin`,
);
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const vendor = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
if (
  hash(manifestBytes) !== prepared.manifestSha256 ||
  hash(binaryBytes) !== prepared.binarySha256 ||
  hash(await raw(vendor)) !== manifest.runtimeSha256 ||
  manifest.actor !== native.cases[0].actor ||
  manifest.build !== native.build ||
  manifest.build !== skin.build
)
  throw Error("Prepared exact-build native animation assets/runtime differ");
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn();
let runtime = null,
  boundary = null,
  samples = 0,
  jointPoses = 0;
let catalogCounts = null;
const mismatches = [],
  observations = [];
const unhex = (value) => new Uint8Array(Buffer.from(value, "hex"));
function compare(view, hex) {
  const expected = unhex(hex),
    actual = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (actual.length !== expected.length)
    throw Error("Native sample length differs");
  let count = 0;
  for (let i = 0; i < actual.length; i++)
    if (actual[i] !== expected[i]) count++;
  return count;
}
try {
  runtime = await createLatestNativeAnimationResources({
    uc,
    profile,
    image,
    spawnBytes,
    manifestBytes,
    binaryBytes,
  });
  const poseManifestBytes = await raw(
      `${cache}/public/latest-animation-poses/manifest.json`,
    ),
    poseManifest = JSON.parse(new TextDecoder().decode(poseManifestBytes));
  const graphs = Object.entries(poseManifest.graphs).filter(
    ([, graph]) => graph.actor === runtime.actor,
  );
  if (graphs.length !== 1)
    throw Error("One exact cached/native animation graph required");
  const boundCatalog = await bindLatestNativeAnimationCatalog({
    profile,
    poseManifestBytes,
    graphFile: graphs[0][0],
    runtime,
  });
  const filesByKey = new Map();
  for (const file of boundCatalog.files) {
    const key = boundCatalog.resourceForFile(file).keyHex;
    const names = filesByKey.get(key) ?? [];
    names.push(file);
    filesByKey.set(key, names);
  }
  if (filesByKey.size !== runtime.resources.length)
    throw Error("Cached catalog does not bind every original resource");
  catalogCounts = {
    clipNames: boundCatalog.clipNames.length,
    poseFiles: boundCatalog.files.length,
    boundResources: filesByKey.size,
  };
  const poses = native.cases[0].animationPoses,
    count = poses.joints.length;
  if (
    JSON.stringify(runtime.jointNames) !==
      JSON.stringify(poses.joints.map((j) => j.name)) ||
    runtime.resources.length !== poses.resources.length ||
    skin.skinMatrices.resources.length !== poses.resources.length
  )
    throw Error("Reusable sampler rig/resource set differs");
  const rootBytes = unhex(poses.worldPoseControl.rootHex),
    rootPose = new Float32Array(rootBytes.buffer);
  const output = runtime.createOutput(),
    ownedOutputs = [output.local, output.world, output.skinMatrices];
  const work = runtime.resources.map((resource, index) => {
    const source = poses.resources[index],
      matrices = skin.skinMatrices.resources[index];
    if (
      Number(BigInt(`0x${resource.keyHex}`)) !== source.key ||
      source.key !== matrices.key ||
      resource.kind !== source.kind ||
      !source.completed ||
      source.samples.length !== matrices.samples.length
    )
      throw Error("Reusable sampler resource identity/order differs");
    return {
      resource,
      index,
      source,
      matrices,
      sampler: boundCatalog.createClipSampler(
        filesByKey.get(resource.keyHex)[0],
      ),
    };
  });
  const rounds = Math.max(...work.map((w) => w.source.samples.length));
  for (const reverseResources of [false, true])
    for (let index = 0; index < rounds; index++) {
      for (const item of reverseResources ? [...work].reverse() : work) {
        const sample = item.source.samples[index],
          matrix = item.matrices.samples[index];
        if (!sample) continue;
        if (sample.time !== matrix.time)
          throw Error("Native sampler control times differ");
        const started = performance.now();
        const returned = item.sampler.sampleInto(
          {
            time: sample.time,
            rootPose,
            inheritScale: poses.worldPoseControl.inheritScale,
          },
          output,
        );
        const elapsedMilliseconds = performance.now() - started;
        if (
          returned !== output ||
          output.local !== ownedOutputs[0] ||
          output.world !== ownedOutputs[1] ||
          output.skinMatrices !== ownedOutputs[2] ||
          !output.worldValid ||
          output.revision !== 1
        )
          throw Error(
            "Reusable sampler replaced caller buffers or lost world-pose validity",
          );
        const localByteMismatches = compare(output.local, sample.localPosesHex),
          worldByteMismatches = compare(output.world, sample.worldPosesHex),
          skinByteMismatches = compare(
            output.skinMatrices,
            matrix.matrices3x4Hex,
          );
        observations.push({
          keyHex: item.resource.keyHex,
          index,
          reverseResources,
          time: sample.time,
          elapsedMilliseconds,
          nativeInstructions: output.nativeInstructions,
          localByteMismatches,
          worldByteMismatches,
          skinByteMismatches,
        });
        if (localByteMismatches || worldByteMismatches || skinByteMismatches)
          mismatches.push(observations.at(-1));
        samples++;
        jointPoses += count;
      }
    }
  for (const item of work) item.sampler.dispose();
} catch (error) {
  boundary = {
    kind: error?.name ?? "WasmExecutionError",
    message: error?.message ?? String(error),
  };
} finally {
  runtime?.close();
}
for (const name of [
  "latest-native-animation-resources.mjs",
  "latest-native-animation-catalog.mjs",
  "latest-vfx-spawn.mjs",
  "native-decoder.mjs",
  "structural-comparison.mjs",
])
  await raw(`${import.meta.dir}/../${name}`);
const result = {
  schema: 1,
  kind: "reusable-native-animation-sampler-comparison",
  build: native.build,
  inputs,
  sourceSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  boundary,
  counts: {
    resources: manifest.resources.length,
    samples,
    jointPoses,
    comparedFloatLanes: jointPoses * 32,
  },
  catalogCounts,
  mismatchCount: mismatches.length,
  mismatches: mismatches.slice(0, 10),
  observations,
  scope: {
    interleavedIndependentClipCaches: true,
    sameBindingsAcrossPasses: true,
    reusedCallerOutputBuffers: true,
    originalAnmWorldAndSkinMatrices: true,
    cachedCatalogBoundByRawSourceHash: true,
    recordedAnimationSelection: false,
    graphBlending: false,
    mainViewerExpanded: false,
  },
};
const path = `${cache}/research/native-animation-sampler-comparison.json`;
await Bun.write(path, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: path,
    counts: result.counts,
    mismatchCount: result.mismatchCount,
    boundary,
  }),
);
if (boundary || mismatches.length) process.exitCode = 1;
