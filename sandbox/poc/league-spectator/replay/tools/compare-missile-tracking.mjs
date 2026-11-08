import { resolve } from "node:path";
import { createLatestMissileTracking } from "../latest-missile-tracking.mjs";
import { createLatestMissileMotion } from "../latest-missiles.mjs";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  const hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Tracking input changed during comparison");
  inputs[path] = hash;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const native = await read(`${cache}/research/missile-tracking-native.json`);
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error(`Tracking native input changed: ${path}`);
for (const [name, hash] of Object.entries(native.sources))
  if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== hash)
    throw Error(`Tracking native producer changed: ${name}`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== native.decoderImageSha256)
  throw Error("Tracking image changed");
for (const range of native.ranges)
  if (
    (await sha256(image.subarray(range.rva, range.rva + range.bytes))) !==
    range.sha256
  )
    throw Error("Tracking original instruction range changed");
const tracking = createLatestMissileTracking({
  build: native.build,
  protocol: native.protocol,
  targetQueryRva: 0x88b5e0,
  controllerQueryRva: 0x88b500,
  controllerFrameRva: 0x88b760,
});
const motion = createLatestMissileMotion(
  await read(`${cache}/public/decoder-16.21-macos/missile-motion.json`),
);
const f = Math.fround;
const encode = (values) =>
  new Uint8Array(new Float32Array(values).buffer).toHex();
const target = (internalId, position, visible) => ({
  kind: "supplied-ai-query-view",
  internalId,
  position,
  visible,
  aimOffset: [2, 3, 4],
  radius: 0,
});
const mismatches = [],
  queries = [],
  frames = [];
let maxError = 0;
for (const [index, c] of native.cases.entries()) {
  const result = tracking.query({
    internalId: c.requestedInternalId,
    target: target(0x10001, c.pose, !!c.visibilityByte201),
    skipHidden: !!c.skipInput,
    modeValue: c.modeInput,
    heightAugment: c.heightAugment,
  });
  if (
    result.resolved !== c.output.accepted ||
    (result.resolved &&
      (encode(result.position) !== c.output.positionHex ||
        encode(result.aimOffset) !== c.output.aimOffsetHex ||
        encode([result.radius]) !== c.output.radiusHex))
  )
    mismatches.push({ query: index, result });
  queries.push({ index, resolved: result.resolved });
}
for (const [index, c] of native.frames.entries()) {
  const state = tracking.initialize({
    tracksTarget: c.settings.mTracksTarget,
    tracksHidden: c.settings.mVisualsTrackHiddenTargets,
    acceptedInternalId: 0x10001,
    endpoint: c.suppliedEndpoint,
    target: target(0x10001, c.initialTargetPose, true),
    heightAugment: c.settings.mTargetHeightAugment,
    modeValue: c.modeInput,
  });
  if (
    encode(state.targetPosition) !== encode(c.initial.targetPosition) ||
    encode(state.aimOffset) !== encode(c.initial.aimOffset) ||
    encode([state.radius]) !== encode([c.initial.radius])
  )
    mismatches.push({ frameCase: index, initial: state });
  for (const [tick, sample] of c.samples.entries()) {
    const result = tracking.update(
      state,
      sample.registered
        ? target(sample.generation, sample.suppliedTargetPose, sample.visible)
        : null,
      c.modeInput,
    );
    if (
      result.resolved !== sample.acceptedQueryExpected ||
      encode(state.targetPosition) !== encode(sample.targetPosition)
    )
      mismatches.push({ frameCase: index, tick, target: state.targetPosition });
    const step = motion.fixedSpeedStep(
      sample.position,
      state.targetPosition,
      c.settings.mSpeed,
      sample.delta,
    );
    const bytes = Uint8Array.fromHex(sample.updateHex),
      view = new DataView(bytes.buffer);
    for (const [key, offset] of [
      ["velocity", 4],
      ["displacement", 16],
    ])
      for (let lane = 0; lane < 3; lane++) {
        const expected = view.getFloat32(offset + lane * 4, true),
          actual = f(step[key][lane]);
        const error = Math.abs(actual - expected);
        maxError = Math.max(error, maxError);
        if (error > 1e-4)
          mismatches.push({
            frameCase: index,
            tick,
            key,
            lane,
            expected,
            actual,
          });
      }
    frames.push({
      frameCase: index,
      tick,
      targetPosition: [...state.targetPosition],
      queryStatus: state.lastQuery,
      ...step,
    });
  }
}
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "..", "latest-missile-tracking.mjs"),
  resolve(import.meta.dir, "..", "latest-missiles.mjs"),
  resolve(import.meta.dir, "..", "structural-comparison.mjs"),
])
  await raw(path);
const report = {
  schema: 1,
  kind: "translated-missile-target-tracking-comparison",
  inputs,
  build: native.build,
  protocol: native.protocol,
  counts: {
    queries: queries.length,
    frameCases: native.frames.length,
    frames: frames.length,
  },
  queries,
  frames,
  mismatches,
  maxError,
  scope: {
    suppliedAcceptedInternalTargets: true,
    nativeOriginalQueryAndFrameCompared: true,
    exactTargetPositionFloat32Bytes: true,
    velocityTolerance: 1e-4,
    actualNetworkTargetAcceptance: false,
    actualMatchAdmissionChanged: false,
    actorPositionApplication: false,
    targetBones: false,
    omissions: tracking.omissions,
  },
};
const output = `${cache}/research/missile-tracking-comparison.json`;
await Bun.write(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    output,
    counts: report.counts,
    mismatches: mismatches.length,
    maxError,
  }),
);
if (mismatches.length) process.exit(1);
