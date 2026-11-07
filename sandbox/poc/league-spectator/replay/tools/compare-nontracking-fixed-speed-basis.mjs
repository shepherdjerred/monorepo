import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { zeroTurnMissileEffectBasis } from "../latest-missile-effect-basis.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("FixedSpeed basis input changed");
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
  `${cache}/research/nontracking-fixed-speed-basis-native-v35.json`,
);
if (
  native.kind !== "original-nontracking-fixed-speed-source-basis-controls" ||
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e" ||
  native.cases.length !== 11 ||
  !native.scope.originalTypedSourceReader ||
  !native.scope.originalCreationLiveAndStoppedCallbacks ||
  !native.scope.fullOriginalDirectionAndVfxSetter ||
  !native.scope.suppliedVelocityControls ||
  native.scope.activeFamilyAdmissionChanged !== false ||
  native.sourceSpell.originalLoadedMovement.mTracksTarget !== false ||
  native.sourceSpell.turnBytesHex !== "0000000000000000"
)
  throw Error(
    "Complete original source-bound FixedSpeed basis control required",
  );
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Original FixedSpeed basis source changed: " + path);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
for (const block of native.blocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original basis instruction block differs");
let samples = 0,
  creations = 0,
  stopped = 0;
for (const group of native.cases) {
  let previous = null;
  if (group.samples.length !== 4)
    throw Error("Complete creation/live/zero/stopped control required");
  for (const row of group.samples) {
    const actual = row.stopped
      ? previous
      : zeroTurnMissileEffectBasis(row.inputVelocity);
    if (
      !actual ||
      row.direction.some(
        (value, index) => !Object.is(value, actual.direction[index]),
      ) ||
      row.matrix
        .filter((_, index) => index < 12 && index % 4 !== 3)
        .some((value, index) => !Object.is(value, actual.basis[index])) ||
      row.weakOwners !== 1
    )
      throw Error("Original FixedSpeed direction/basis bits differ");
    if (row.creation) creations++;
    if (row.stopped) stopped++;
    samples++;
    previous = actual;
  }
}
if (samples !== 44 || creations !== 11 || stopped !== 11)
  throw Error("All bounded FixedSpeed basis controls required");
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("FixedSpeed basis comparison drifted");
const output = `${cache}/research/nontracking-fixed-speed-basis-comparison-v35.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "translated-nontracking-fixed-speed-basis-comparison",
      artifactVersion: 35,
      inputs,
      cases: 11,
      samples,
      creationSamples: creations,
      stoppedSamples: stopped,
      directionLanes: samples * 3,
      basisLanes: samples * 9,
      mismatches: 0,
      scope: {
        originalTypedSourceAndCallbackCompared: true,
        bitExactIncludingSignedZero: true,
        suppliedVelocities: true,
        actualEndpointRangeRecovered: false,
        actualMatchMotionEstablished: false,
        activeFamilyAdmissionChanged: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    cases: 11,
    samples,
    directionLanes: samples * 3,
    basisLanes: samples * 9,
    mismatches: 0,
  }),
);
