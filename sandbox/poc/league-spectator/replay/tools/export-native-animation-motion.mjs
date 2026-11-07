// Controlled clip playback through the reusable original ANM sampler.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLatestNativeAnimationResources } from "../latest-native-animation-resources.mjs";
import { bindLatestNativeAnimationCatalog } from "../latest-native-animation-catalog.mjs";
const [cachePath] = process.argv.slice(2);
if (!cachePath)
  throw Error("Usage: bun export-native-animation-motion.mjs <cache>");
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
  JSON.parse(new TextDecoder().decode(await raw(path)));
const proof = await json(
  `${cache}/research/native-animation-sampler-comparison.json`,
);
if (
  proof.boundary ||
  proof.mismatchCount ||
  !proof.scope.cachedCatalogBoundByRawSourceHash
)
  throw Error("Complete reusable native sampler comparison required");
if (
  hash(await raw(`${import.meta.dir}/compare-native-animation-sampler.mjs`)) !==
  proof.sourceSha256
)
  throw Error("Native sampler comparison producer changed");
for (const [path, expected] of Object.entries(proof.inputs))
  if (hash(await raw(path)) !== expected)
    throw Error(`Native sampler input changed: ${path}`);
const profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  spawnBytes = await raw(`${cache}/public/decoder-16.21-macos/vfx-spawn.json`),
  manifestBytes = await raw(
    `${cache}/public/latest-native-animation-resources/manifest.json`,
  ),
  binaryBytes = await raw(
    `${cache}/public/latest-native-animation-resources/static.bin`,
  ),
  poseManifestBytes = await raw(
    `${cache}/public/latest-animation-poses/manifest.json`,
  ),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  poseManifest = JSON.parse(new TextDecoder().decode(poseManifestBytes));
const vendor = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
if (hash(await raw(vendor)) !== manifest.runtimeSha256)
  throw Error("Pinned native animation WASM runtime required");
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn();
const runtime = await createLatestNativeAnimationResources({
  uc,
  profile,
  image,
  spawnBytes,
  manifestBytes,
  binaryBytes,
});
const fps = 24,
  frameCount = 72,
  count = runtime.jointNames.length,
  names = ["Attack1", "Recall"];
const bytesPerSample = count * 12 * 4,
  allBytes = new Uint8Array(bytesPerSample * frameCount * names.length);
const clips = [];
let samples = 0;
try {
  const graphs = Object.entries(poseManifest.graphs).filter(
    ([, g]) => g.actor === runtime.actor,
  );
  if (graphs.length !== 1)
    throw Error("One exact native motion graph required");
  const bound = await bindLatestNativeAnimationCatalog({
    profile,
    poseManifestBytes,
    graphFile: graphs[0][0],
    runtime,
  });
  const work = names.map((name) => {
    const file = bound.fileForClip(name),
      resource = bound.resourceForFile(file);
    const record = {
      name,
      file,
      keyHex: resource.keyHex,
      kind: resource.kind,
      frames: [],
    };
    clips.push(record);
    return { record, resource, sampler: bound.createClipSampler(file) };
  });
  const output = runtime.createOutput(),
    rootPose = new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 0, 1]);
  for (let frame = 0; frame < frameCount; frame++)
    for (let index = 0; index < work.length; index++) {
      const { record, resource, sampler } = work[index],
        time = Math.min(
          frame / fps,
          Math.fround((resource.frames - 1) / resource.fps),
        );
      sampler.sampleInto({ time, rootPose, inheritScale: true }, output);
      const offset = (frame * work.length + index) * bytesPerSample;
      allBytes.set(
        new Uint8Array(
          output.skinMatrices.buffer,
          output.skinMatrices.byteOffset,
          output.skinMatrices.byteLength,
        ),
        offset,
      );
      record.frames.push({
        time,
        offset,
        bytes: bytesPerSample,
        nativeInstructions: output.nativeInstructions,
      });
      samples++;
    }
  for (const item of work) item.sampler.dispose();
} finally {
  runtime.close();
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
  kind: "controlled-native-animation-motion",
  build: profile.clientVersion,
  actor: runtime.actor,
  fps,
  frameCount,
  jointNames: runtime.jointNames,
  clips,
  inputs,
  binarySha256: hash(allBytes),
  sourceSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  scope: {
    originalAnmWorldAndSkinInWasm: true,
    controlledClipSelection: true,
    controlledIdentityRoot: true,
    terminalKeyframeHeld: true,
    recordedMatchPlayback: false,
    graphBlending: false,
    mainViewerExpanded: false,
  },
};
const path = `${cache}/research/native-animation-sampler-motion`;
await Bun.write(`${path}.bin`, allBytes);
await Bun.write(`${path}.json`, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: `${path}.json`,
    frames: frameCount,
    samples,
    binaryBytes: allBytes.length,
  }),
);
