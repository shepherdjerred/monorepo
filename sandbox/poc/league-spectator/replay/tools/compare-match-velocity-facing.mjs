import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { createLatestMissileMotion } from "../latest-missiles.mjs";
import { createLatestMissileControllers } from "../latest-missile-controllers.mjs";
import { createLatestMissileFrame } from "../latest-missile-frame.mjs";
import {
  matchVelocityVerticalFacing,
  stepPresentationMissileFrame,
} from "../latest-match-velocity-facing.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  const hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Facing input changed");
  inputs[path] = hash;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const native = await read(
  `${cache}/research/match-velocity-facing-native.json`,
);
if (
  native.kind !== "original-match-velocity-facing-controls" ||
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e"
)
  throw Error("Exact original facing controls required");
for (const [name, hash] of Object.entries(native.sources))
  if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== hash)
    throw Error(`Native facing producer changed: ${name}`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== native.decoderImageSha256)
  throw Error("Facing image changed");
for (const block of native.blocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.bytes))) !==
    block.sha256
  )
    throw Error("Facing original instruction mismatch");
if (
  image.subarray(native.threshold.rva, native.threshold.rva + 4).toHex() !==
  native.threshold.bytesHex
)
  throw Error("Facing threshold mismatch");
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const definitions = {};
for (const [name, key] of [
  ["motion", "missileMotionSha256"],
  ["controllers", "missileControllersSha256"],
]) {
  const bytes = await raw(
    `${cache}/public/decoder-16.21-macos/missile-${name}.json`,
  );
  if ((await sha256(bytes)) !== profile[key])
    throw Error("Facing kernel package changed");
  definitions[name] = JSON.parse(new TextDecoder().decode(bytes));
}
const motion = createLatestMissileMotion(definitions.motion),
  controllers = createLatestMissileControllers(definitions.controllers);
const frame = createLatestMissileFrame(
  definitions.controllers,
  motion,
  controllers,
  null,
);
const hex = (values) => new Uint8Array(new Float32Array(values).buffer).toHex();
const mismatches = [];
for (const [index, c] of native.cases.entries())
  if (
    hex([matchVelocityVerticalFacing(c.displacement, c.delta)]) !== c.resultHex
  )
    mismatches.push({ case: index });
let frames = 0;
for (const [index, c] of native.frames.entries()) {
  const state = frame.initialize({
    movementType: "FixedSpeedMovement",
    settings: { mTracksTarget: false, mStartDelay: 0 },
    cast: { targetCount: 0 },
    packetInitialization: {
      status: "initialized-position-fields",
      currentPosition: c.position,
      initialPosition: c.position,
      targetPosition: c.target,
      movementSpeed: c.speed,
    },
    controllerScalarB0: Math.fround(3.4028234663852886e38),
    controllerScalarB4: 0,
    uninterpretedMovementFields: [],
    heightController: { status: "none", type: null, settings: null },
    verticalFacingType: null,
  });
  state.verticalFacingType = "VeritcalFacingMatchVelocity";
  for (const [tick, sample] of c.samples.entries()) {
    const result = stepPresentationMissileFrame(
        frame,
        state,
        sample.time,
        c.delta,
      ),
      bytes = Uint8Array.fromHex(sample.updateHex);
    const expected = new DataView(bytes.buffer);
    if (
      hex(result.velocity) !== bytes.subarray(4, 16).toHex() ||
      hex(result.displacement) !== bytes.subarray(16, 28).toHex() ||
      result.historySize !== sample.historySize ||
      result.speed !== expected.getFloat32(0, true)
    )
      mismatches.push({
        frame: index,
        tick,
        result,
        expected: sample.updateHex,
      });
    frames++;
  }
}
for (const path of [
  import.meta.path,
  ...[
    "latest-match-velocity-facing.mjs",
    "latest-missile-frame.mjs",
    "latest-missile-controllers.mjs",
    "latest-missiles.mjs",
    "structural-comparison.mjs",
  ].map((name) => resolve(import.meta.dir, "..", name)),
])
  await raw(path);
const output = `${cache}/research/match-velocity-facing-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      build: native.build,
      protocol: native.protocol,
      kind: "match-velocity-facing-comparison",
      inputs,
      cases: native.cases.length,
      frameCases: native.frames.length,
      frames,
      mismatches,
      scope: native.scope,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    cases: native.cases.length,
    frames,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) throw Error("Original MatchVelocity disagreement");
