import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { zeroTurnMissileEffectBasis } from "../latest-missile-effect-basis.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error(`Changed basis input: ${path}`);
  inputs[path] = hash;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/missile-effect-basis-native.json`);
if (
  native.kind !== "original-missile-velocity-effect-basis" ||
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e" ||
  native.cases.length !== 6 ||
  native.controls.length !== 11 ||
  !native.scope.allAuthoredSpellFieldsPassedToOriginalReader ||
  !native.scope.originalReaderUnknownFieldsRemainExplicit ||
  !native.scope.fullOriginalDirectionCallback ||
  !native.scope.fullOriginalVfxDirectionSetter ||
  native.scope.fullOriginalMissileFrame ||
  native.scope.nativeMatchAcceptance !== null
)
  throw Error("Complete bounded original missile basis evidence required");
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Stale original missile basis evidence: ${path}`);
const decoder = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
for (const block of native.blocks)
  if (
    (await sha256(decoder.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error(`Original executed basis block differs: ${block.rva}`);
let samples = 0,
  liveSamples = 0,
  stoppedSamples = 0,
  directionLanes = 0,
  basisLanes = 0;
const compare = (expected, actual, label) => {
  if (
    expected.length !== actual.length ||
    expected.some((lane, i) => !Object.is(lane, actual[i]))
  )
    throw Error(`Float32 original missile basis mismatch: ${label}`);
};
for (const group of [
  ...native.cases,
  { sourceEventId: "native-controls", samples: native.controls },
]) {
  let previous = null;
  for (const row of group.samples) {
    const value = row.stopped
      ? previous
      : zeroTurnMissileEffectBasis(row.inputVelocity);
    if (!value)
      throw Error("A stopped missile requires its retained live basis");
    compare(
      row.direction,
      value.direction,
      `${group.sourceEventId}:direction:${row.time}`,
    );
    compare(
      row.matrix.filter((_, i) => i < 12 && i % 4 !== 3),
      value.basis,
      `${group.sourceEventId}:matrix:${row.time}`,
    );
    if (row.weakOwners !== 1)
      throw Error("Original callback leaked supplied weak-holder ownership");
    samples++;
    directionLanes += 3;
    basisLanes += 9;
    if (row.stopped) stoppedSamples++;
    else liveSamples++;
    previous = value;
  }
}
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Basis comparison input changed: ${path}`);
const result = {
  schema: 1,
  kind: "native-direct-missile-effect-basis-comparison",
  inputs,
  counts: {
    cases: native.cases.length,
    controls: native.controls.length,
    samples,
    liveSamples,
    stoppedSamples,
    directionLanes,
    basisLanes,
  },
  controls: {
    bitExactIncludingSignedZero: true,
    originalCreationCallback: true,
    originalStoppedCallbackBranch: true,
    nativeTypedSpellDefaultsAndFields: true,
  },
  scope: {
    fullNativeMissileFrame: false,
    nativeMatchAcceptance: null,
    browserPlaybackObserved: false,
  },
};
const output = `${cache}/research/missile-effect-basis-comparison.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    counts: result.counts,
    fingerprints: Object.keys(inputs).length,
  }),
);
