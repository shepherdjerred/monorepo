import { resolve } from "node:path";
import {
  compileZeroReferenceFixedTimeSpec,
  createZeroReferenceFixedTimeController,
} from "../latest-zero-reference-fixed-time.mjs";
import { createFixedTimeMovement } from "../latest-fixed-time-movement.mjs";
import { createLatestMissileMotion } from "../latest-missiles.mjs";
import { createLatestMissileControllers } from "../latest-missile-controllers.mjs";
import { createLatestMissileInitialization } from "../latest-missile-initialization.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const schedule = process.argv[3] ?? "creation-ticks";
if (
  ![
    "creation-ticks",
    "replay-uniform",
    "replay-event-splits",
    "supplied-interior-split",
  ].includes(schedule)
)
  throw Error("Explicit original controller schedule required");
const suffix = schedule === "creation-ticks" ? "" : `-${schedule}`;
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Zero-reference source changed");
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
  `${cache}/research/zero-reference-fixed-time${suffix}-native.json`,
);
if (
  native.kind !== "original-zero-reference-fixed-time-controls" ||
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e" ||
  native.frameSchedule !== schedule
)
  throw Error("Exact zero-reference native proof required");
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Native zero-reference source changed: " + path);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  defs = {};
for (const [name, key] of [
  ["motion", "missileMotionSha256"],
  ["controllers", "missileControllersSha256"],
]) {
  const bytes = await raw(
    `${cache}/public/decoder-16.21-macos/missile-${name}.json`,
  );
  if ((await sha256(bytes)) !== profile[key])
    throw Error("Exact numeric package required");
  defs[name] = JSON.parse(new TextDecoder().decode(bytes));
}
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== profile.decoderImageSha256)
  throw Error("Original image digest differs");
for (const block of native.originalBlocks)
  if (
    (await sha256(image.subarray(block.startRva, block.endRva))) !==
    block.sha256
  )
    throw Error("Native zero-reference instruction pin differs");
const scene = await read(`${cache}/public/latest-scene/manifest.json`),
  heightBytes = await raw(`${cache}/public/latest-scene/heights.bin`);
const terrain = createLatestTerrain(
  scene,
  new Float32Array(
    heightBytes.buffer,
    heightBytes.byteOffset,
    heightBytes.byteLength / 4,
  ),
);
const controller = createZeroReferenceFixedTimeController({
  kernel: createFixedTimeMovement(
    createLatestMissileMotion(defs.motion),
    createLatestMissileControllers(defs.controllers),
  ),
  initialization: createLatestMissileInitialization(defs.controllers),
  terrain,
});
const hex = (v) => new Uint8Array(new Float32Array(v).buffer).toHex();
const snapshot = (state) => ({
  positionHex: hex(state.position),
  velocityHex: hex(state.velocity),
  initialPositionHex: hex(state.initialPosition),
  targetPositionHex: hex(state.targetPosition),
  speedHex: hex([state.speed]),
  deadlineHex: hex([state.deadline]),
  holderPresent: false,
  holderInternalId: null,
});
const mismatches = [];
let frames = 0,
  lanes = 0;
for (const c of native.cases) {
  const asset =
    scene.champions[`${c.ownerCharacter.toLowerCase()}/${c.ownerSkinId}`];
  if (!asset || asset.spellCatalog !== c.sourceCatalog)
    throw Error("Exact source spell catalog missing");
  const catalog = await read(
      `${cache}/public/latest-scene/${asset.spellCatalog}`,
    ),
    source = catalog.spells[c.record.cast.spellHash].data.mMissileSpec;
  const spec = compileZeroReferenceFixedTimeSpec(source, defs.motion),
    state = controller.initialize({ record: c.record, start: c.start, spec });
  for (const [label, actual, expected] of [
    ["constructor", snapshot(state.beforePacket), c.beforePacket],
    ["first-packet", snapshot(state.state), c.afterPacket],
  ]) {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      mismatches.push({ sequence: c.sequence, label, actual, expected });
    lanes += 14;
  }
  for (const [tick, sample] of c.samples.entries()) {
    const before = snapshot(state.state),
      result = controller.step(
        state,
        sample.time,
        sample.delta,
        sample.globalDelta,
      ),
      bytes = Uint8Array.fromHex(sample.updateHex),
      view = new DataView(bytes.buffer);
    if (
      JSON.stringify(before) !== JSON.stringify(sample.before) ||
      hex(result.velocity) !== bytes.subarray(4, 16).toHex() ||
      hex(result.displacement) !== bytes.subarray(16, 28).toHex() ||
      result.speed !== view.getFloat32(0, true) ||
      result.arrived !== sample.arrived ||
      hex(state.state.targetPosition) !== sample.after.targetPositionHex
    )
      mismatches.push({
        sequence: c.sequence,
        tick,
        before,
        result,
        expected: sample,
      });
    frames++;
    lanes += 24;
  }
}
if (
  native.cases.length !== 3 ||
  (schedule === "creation-ticks" && frames !== 81) ||
  (schedule === "replay-uniform" && frames !== 78) ||
  (schedule === "replay-event-splits" && frames < 78)
)
  throw Error("All bounded actual zero-reference controls required");
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Zero-reference comparison source changed");
const output = `${cache}/research/zero-reference-fixed-time${suffix}-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "translated-zero-reference-fixed-time-original-comparison",
      build: native.build,
      protocol: native.protocol,
      inputs,
      cases: native.cases.length,
      frames,
      lanesCompared: lanes,
      mismatches,
      scope: {
        authoredTracksTargetPreserved: true,
        originalHolderAbsenceCompared: true,
        originalConstructorAndPacketCompared: true,
        originalControllerFrameCompared: true,
        actualFamilyAdmission: false,
        nativeMatchMotionAccepted: false,
      },
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
    lanesCompared: lanes,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) throw Error("Zero-reference original comparison failed");
