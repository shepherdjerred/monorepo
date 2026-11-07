import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { sampleNativeAtomicClock } from "../latest-animation-clock.mjs";
import {
  compileAnimationPoseTimeDomain,
  validateAnimationPoseTimeDomain,
  sampleDualClockAnimationPoseFrame,
} from "../latest-animation-pose-time-domain.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-lineup-5667809143"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const native = JSON.parse(
  new TextDecoder().decode(
    await raw(`${cache}/research/animation-dual-clock-native.json`),
  ),
);
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Dual-clock native input changed: " + path);
const scalar = (hex) => {
  const bytes = Uint8Array.from(hex.match(/../g), (value) =>
    parseInt(value, 16),
  );
  return new DataView(bytes.buffer).getFloat32(0, true);
};
const mismatches = [],
  cases = [];
let samples = 0,
  lanes = 0;
for (const source of native.cases) {
  const clip = {
    fps: source.authoredIntegerFps,
    poseTimeDomain: compileAnimationPoseTimeDomain(
      source.reference,
      source.authoredIntegerFps,
    ),
  };
  validateAnimationPoseTimeDomain(source.reference, clip);
  for (const sample of source.samples) {
    const actual = sampleNativeAtomicClock(
      source.reference.clock,
      sample.input.elapsed,
      sample.input.delta,
      sample.input.rate,
    );
    const expected = {
      frame: scalar(sample.native.frameHex),
      elapsed: scalar(sample.native.elapsedHex),
      duration: scalar(sample.native.durationHex),
      poseFrame: scalar(sample.native.poseFrameHex),
      poseTime: scalar(sample.native.poseTimeHex),
    };
    for (const [key, value] of Object.entries(expected)) {
      lanes++;
      if (!Object.is(actual[key], value))
        mismatches.push({
          graph: source.graph,
          clip: source.clip,
          input: sample.input,
          key,
          actual: actual[key],
          expected: value,
        });
    }
    const frame = sampleDualClockAnimationPoseFrame(actual.poseTime, clip);
    lanes++;
    if (!Object.is(frame, scalar(sample.presentationSampleFrameHex)))
      mismatches.push({
        graph: source.graph,
        clip: source.clip,
        input: sample.input,
        presentationSampleFrame: frame,
      });
    samples++;
  }
  cases.push({
    graph: source.graph,
    clip: source.clip,
    domain: clip.poseTimeDomain,
    samples: source.samples.length,
  });
}
if (cases.length !== 4 || !samples || mismatches.length)
  throw Error(
    "Original dual-clock comparison failed: " +
      JSON.stringify(mismatches.slice(0, 3)),
  );
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Dual-clock source changed");
const output = `${cache}/research/animation-dual-clock-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "verified-original-legacy-animation-dual-clock-comparison",
      inputs,
      cases,
      samples,
      lanes,
      mismatches,
      scope: {
        originalHeaderFPSAndAtomicClockCompared: true,
        presentationSampleGridPolicyExplicit: true,
        nativePoseInterpolationParity: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    clips: cases.length,
    samples,
    lanes,
    mismatches: mismatches.length,
  }),
);
