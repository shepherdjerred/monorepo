import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { sha256 } from "../structural-comparison.mjs";
import { createSubmeshVisibilityScheduler } from "../latest-submesh-visibility.mjs";
import {
  assertSelectedSubmeshProgram,
  deriveSelectedSubmeshAsset,
} from "../latest-selected-submesh.mjs";
import { SUBMESH_VISIBILITY_SHA } from "../latest-submesh-visibility-contract.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [
    cacheArg = ".cache/replay-lineup-5667809143",
    referenceArg = ".cache/replay-spike/public/latest-submesh-visibility/package.json",
  ] = process.argv.slice(2),
  cache = resolve(cacheArg),
  inputs = {},
  tools = import.meta.dir;
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
}
const read = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  equal = (actual, expected, reason) => {
    if (!isDeepStrictEqual(actual, expected)) throw Error(reason);
  };
await captureDirectSourceInputs([import.meta.path], raw);
const referenceBytes = await raw(referenceArg),
  reference = JSON.parse(new TextDecoder().decode(referenceBytes)),
  bytes = await raw(`${cache}/public/latest-submesh-visibility/package.json`),
  metadata = JSON.parse(new TextDecoder().decode(bytes)),
  nativeBytes = await raw(`${cache}/research/submesh-visibility-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  sceneBytes = await raw(`${cache}/public/latest-scene/manifest.json`),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes)),
  world = await read(`${cache}/public/latest-scene/${scene.world}`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if (
  (await sha256(referenceBytes)) !== SUBMESH_VISIBILITY_SHA ||
  native.packageSha256 !== (await sha256(bytes)) ||
  native.preparerSha256 !==
    (await sha256(await raw(`${tools}/prepare-submesh-visibility.py`)))
)
  throw Error("Selected native submesh proof differs");
assertSelectedSubmeshProgram(reference, metadata, await sha256(sceneBytes));
for (const [path, digest] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale submesh input: ${path}`);
for (const [name, digest] of Object.entries(native.sources))
  if ((await sha256(await raw(`${tools}/${name}`))) !== digest)
    throw Error(`Stale submesh source: ${name}`);
for (const block of native.originalBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original submesh instruction differs");
let frames = 0,
  checkpointChecks = 0,
  assets = 0,
  eventGroups = 0;
for (const sequence of native.sequences) {
  const scheduler = createSubmeshVisibilityScheduler(
    sequence.names,
    sequence.events,
    sequence.initial,
    sequence.avatar,
  );
  for (const frame of sequence.frames) {
    const checkpoint = scheduler.checkpoint(),
      actual = scheduler.step(frame.frame, frame.resync);
    equal(
      actual,
      frame.output,
      `Native mask/state differs: ${sequence.name}:${frame.frame}`,
    );
    frames++;
    scheduler.restore(checkpoint);
    equal(
      scheduler.step(frame.frame, frame.resync),
      actual,
      "Checkpoint replay differs",
    );
    scheduler.releaseCheckpoint(checkpoint);
    checkpointChecks++;
  }
}
const expected = {};
for (const [actor, asset] of [
  ...Object.entries(scene.champions).map(([key, value]) => [
    `champions/${key}`,
    value,
  ]),
  ...Object.entries(world.assets)
    .filter(([, value]) => value.animationGraph)
    .map(([key, value]) => [`world/${key}`, value]),
]) {
  const root = `${cache}/public/latest-scene`,
    skn = asset.model.replace(/\.[^.]+$/, ".skn"),
    derived = await deriveSelectedSubmeshAsset(
      actor,
      asset,
      await raw(`${root}/${asset.model}`),
      await raw(`${root}/${asset.animationGraph}`),
      await raw(`${root}/${skn}`),
    );
  equal(
    derived,
    metadata.assets[asset.animationGraph],
    "Derived selected authored asset differs",
  );
  expected[asset.animationGraph] = derived;
  assets++;
  eventGroups += Object.keys(derived.clips).length;
}
equal(expected, metadata.assets, "Missing or extra selected asset");
if (
  frames !== native.counts.frames ||
  assets !== native.counts.assets ||
  eventGroups !== native.counts.groups
)
  throw Error("Incomplete selected native comparison inventory");
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Selected submesh input changed: ${path}`);
const report = {
  schema: 1,
  kind: "selected-submesh-native-comparison",
  inputs,
  packageSha256: await sha256(bytes),
  nativeEvidenceSha256: await sha256(nativeBytes),
  fixedReferenceSha256: SUBMESH_VISIBILITY_SHA,
  counts: {
    ...native.counts,
    nativeFrames: frames,
    checkpointChecks,
    derivedAssets: assets,
    derivedEventGroups: eventGroups,
  },
  mismatches: 0,
  scope: {
    nativeResourceMapConstructorExecuted: true,
    nativeSchedulerExecuted: true,
    completeSelectedActorInventoryDerived: true,
    suppliedBoundaryClock: true,
    actualFactoryCatalogControlPending: true,
    nativeAnimationClockRecovered: false,
    graphicsSubmissionExecuted: false,
    browserObserved: false,
  },
};
await Bun.write(
  `${cache}/research/selected-submesh-comparison.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ counts: report.counts, mismatches: 0 }));
