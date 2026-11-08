import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { createLatestMissileMotion } from "../latest-missiles.mjs";
import { zeroTurnMissileEffectBasis } from "../latest-missile-effect-basis.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Tracking basis input drift");
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
  `${cache}/research/tracking-fixed-speed-basis-native-v38.json`,
);
assert.equal(
  native.kind,
  "original-tracking-fixed-speed-source-basis-controls",
);
assert.equal(native.build, "16.21.829.8620");
assert.equal(native.protocol, "20e09df23c66b85e");
assert.equal(native.sourceSpell.originalLoadedMovement.mTracksTarget, true);
assert.equal(native.sourceSpell.turnBytesHex, "0000000000000000");
assert(native.sourceSpell.allAuthoredFieldsPassedToOriginalReader);
assert(native.scope.initialVelocityCorrectedByOriginalInitializerConsumer);
assert.equal(native.scope.originalTrackingTargetQueryReexecuted, false);
assert.equal(native.scope.fullNativeMissileActorOrWorld, false);
assert.equal(native.scope.activeFamilyAdmissionChanged, false);
assert.deepEqual(
  native.cases.map((row) => row.sequence),
  [2977, 3830, 3845, 3880],
);
for (const [path, digest] of Object.entries(native.inputs))
  assert.equal(
    await sha256(await raw(path)),
    digest,
    `Native tracking basis prerequisite: ${path}`,
  );
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  motionBytes = await raw(
    `${cache}/public/decoder-16.21-macos/missile-motion.json`,
  );
assert.equal(await sha256(image), profile.decoderImageSha256);
assert.equal(await sha256(motionBytes), profile.missileMotionSha256);
for (const block of native.blocks)
  assert.equal(
    await sha256(image.subarray(block.rva, block.rva + block.size)),
    block.sha256,
  );
const motion = createLatestMissileMotion(
    JSON.parse(new TextDecoder().decode(motionBytes)),
  ),
  hex = (values) =>
    Buffer.from(Float32Array.from(values).buffer).toString("hex");
function same(a, b, label) {
  assert.equal(a.length, b.length, `${label}: width`);
  assert.equal(hex(a), hex(b), `${label}: exact float32 bits`);
  a.forEach((value, lane) =>
    assert(Object.is(value, b[lane]), `${label}: lane${lane}`),
  );
}
function fullMatrix(basis) {
  return [
    ...basis.slice(0, 3),
    0,
    ...basis.slice(3, 6),
    0,
    ...basis.slice(6, 9),
    0,
    0,
    0,
    0,
    1,
  ];
}
let actualSamples = 0,
  controlSamples = 0,
  stoppedSamples = 0,
  initializedVelocities = 0;
for (const [actual, cases] of [
  [true, native.cases],
  [false, native.controls],
]) {
  for (const group of cases) {
    if (actual) {
      const init = group.initializer;
      assert.equal(
        init.policy,
        "supplied-causal-retained-target-position-consumer-only",
      );
      assert.equal(init.targetRegistryAndQueryReexecuted, false);
      assert.equal(
        init.constructorCachedAimOffsetHex,
        "000000000000000000000000",
      );
      const expected = motion.fixedSpeedStep(
        init.position,
        init.targetPosition,
        init.movementSpeed,
        0,
      ).velocity;
      same(
        expected,
        init.originalInitializerVelocity,
        `initializer${group.sequence}`,
      );
      assert.equal(hex(expected), init.originalInitializerVelocityHex);
      same(
        expected,
        group.samples[0].inputVelocity,
        "birth callback uses native initializer, not first future velocity",
      );
      assert(expected.some((lane) => lane !== 0));
      assert.deepEqual(init.preInitializerPresentationVelocity, [0, 0, 0]);
      initializedVelocities++;
    } else assert.equal(group.samples.length, 4);
    let previous = null;
    for (const row of group.samples) {
      assert.equal(row.weakOwners, 1);
      const result = row.stopped
        ? previous
        : zeroTurnMissileEffectBasis(row.inputVelocity);
      assert(
        result,
        "Stopped direction requires a previously established callback state",
      );
      same(result.direction, row.direction, "callback direction");
      const matrix = fullMatrix(result.basis);
      same(matrix, row.matrix, "full native direction matrix");
      assert.equal(hex(matrix), row.matrixHex);
      if (row.stopped) stoppedSamples++;
      if (actual) actualSamples++;
      else controlSamples++;
      previous = result;
    }
  }
}
assert.equal(actualSamples, 36);
assert.equal(controlSamples, 44);
assert.equal(initializedVelocities, 4);
assert.equal(native.excludedCandidates.length, 14);
assert.equal(
  native.excludedCandidates.filter((row) =>
    row.reasons.includes("missile:pose:viewer-actor-orientation-unresolved"),
  ).length,
  12,
);
assert.equal(
  native.excludedCandidates.filter((row) =>
    row.reasons.includes(
      "missile:target:initial-presentation-view-unresolved-or-rejected",
    ),
  ).length,
  2,
);
for (const [path, digest] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    digest,
    `Tracking comparison drift: ${path}`,
  );
const output = `${cache}/research/tracking-fixed-speed-basis-comparison-v38.json`,
  report = {
    schema: 1,
    kind: "translated-tracking-fixed-speed-initializer-and-basis-comparison",
    artifactVersion: 38,
    build: native.build,
    protocol: native.protocol,
    replaySha256: native.replaySha256,
    inputs,
    cases: 4,
    actualSamples,
    controls: 11,
    controlSamples,
    initializedVelocities,
    stoppedSamples,
    directionLanes: (actualSamples + controlSamples) * 3,
    matrixLanes: (actualSamples + controlSamples) * 16,
    mismatches: 0,
    excludedCandidates: native.excludedCandidates,
    scope: {
      originalInitializerConsumerAndDirectionCallback: true,
      bitExactIncludingSignedZero: true,
      suppliedCausalRetainedTargetView: true,
      originalTargetRegistryAndQueryReexecuted: false,
      preInitializerZeroPresentationVelocityIsNotNativeBirthVelocity: true,
      fullNativeMissileActorOrWorld: false,
      nativeMatchAcceptance: null,
      arbitraryRotationEstablished: false,
      activeFamilyAdmissionChanged: false,
      gpuSubmitted: false,
    },
  };
await Bun.write(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    output,
    cases: 4,
    actualSamples,
    controlSamples,
    initializedVelocities,
    matrixLanes: report.matrixLanes,
    mismatches: 0,
  }),
);
