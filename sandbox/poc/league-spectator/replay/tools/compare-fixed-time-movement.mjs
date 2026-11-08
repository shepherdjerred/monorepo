import { resolve } from "node:path";
import { createFixedTimeMovement } from "../latest-fixed-time-movement.mjs";
import { createLatestMissileMotion } from "../latest-missiles.mjs";
import { createLatestMissileControllers } from "../latest-missile-controllers.mjs";
import { createLatestMissileInitialization } from "../latest-missile-initialization.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  const hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("FixedTime input changed");
  inputs[path] = hash;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const native = await read(`${cache}/research/fixed-time-movement-native.json`);
if (
  native.kind !== "original-fixed-time-gravity-controller-controls" ||
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e"
)
  throw Error("Exact FixedTime controls required");
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("FixedTime native terrain changed");
for (const [name, hash] of Object.entries(native.sources))
  if ((await sha256(await raw(resolve(import.meta.dir, name)))) !== hash)
    throw Error(`FixedTime native producer changed: ${name}`);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
if ((await sha256(image)) !== native.decoderImageSha256)
  throw Error("FixedTime image changed");
for (const block of native.blocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.bytes))) !==
    block.sha256
  )
    throw Error("FixedTime instructions changed");
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
    throw Error("FixedTime shared package changed");
  defs[name] = JSON.parse(new TextDecoder().decode(bytes));
}
const kernel = createFixedTimeMovement(
  createLatestMissileMotion(defs.motion),
  createLatestMissileControllers(defs.controllers),
);
const hex = (v) => new Uint8Array(new Float32Array(v).buffer).toHex();
const vector = (text) =>
  Array.from(new Float32Array(Uint8Array.fromHex(text).buffer));
const mismatches = [];
let frames = 0;
for (const [index, c] of native.cases.entries()) {
  const state = kernel.initialize({
    position: c.position,
    targetPosition: vector(c.initial.targetPositionHex),
    travelTime: c.duration,
    startDelay: 0,
    createdAt: c.createdAt,
    travelTimeOverride: c.override,
    gravity: c.gravity,
  });
  if (
    state.duration !== c.initial.duration ||
    state.deadline !== c.initial.deadline ||
    state.speed !== c.initial.speed ||
    hex(state.velocity) !== c.initial.actorVelocityHex
  )
    mismatches.push({ case: index, initial: state, expected: c.initial });
  for (const [tick, s] of c.samples.entries()) {
    state.targetPosition = vector(s.suppliedTargetPositionHex);
    const result = kernel.step(state, s.time, s.delta),
      bytes = Uint8Array.fromHex(s.updateHex),
      view = new DataView(bytes.buffer);
    if (
      hex(result.velocity) !== bytes.subarray(4, 16).toHex() ||
      hex(result.displacement) !== bytes.subarray(16, 28).toHex() ||
      result.speed !== view.getFloat32(0, true) ||
      result.arrived !== s.arrived ||
      result.historySize !== s.historySize
    )
      mismatches.push({ case: index, tick, result, expected: s });
    frames++;
  }
}
const initializer = createLatestMissileInitialization(defs.controllers),
  manifest = await read(`${cache}/public/latest-scene/manifest.json`),
  heightBytes = await raw(`${cache}/public/latest-scene/heights.bin`),
  terrain = createLatestTerrain(
    manifest,
    new Float32Array(
      heightBytes.buffer,
      heightBytes.byteOffset,
      heightBytes.byteLength / 4,
    ),
  );
for (const c of native.packetControls) {
  const result = initializer.initializeFixedSpeedPacket(
    {
      elapsedSeconds: 0,
      movementSpeed: c.expectedPacketSpeed,
      cast: c.decodedCast,
    },
    {
      mUseHeightOffsetAtEnd: c.settings.mUseHeightOffsetAtEnd ?? false,
      mTargetHeightAugment: c.settings.mTargetHeightAugment ?? 0,
    },
    {
      status: "initialized",
      position: c.suppliedCurrentPosition,
      planeHeightOffset: 0,
      attachmentHeightOffset: 0,
    },
    { status: "initialized", position: c.suppliedTargetPosition },
    terrain,
  );
  if (
    hex(result.initialPosition) !== c.initialPositionHex ||
    hex(result.targetPosition) !== c.targetPositionHex ||
    hex([result.targetHeightAugment]) !== c.heightAugmentHex ||
    hex([result.movementSpeed]) !== c.speedHex ||
    c.actorPositionBeforeHex !== c.actorPositionAfterHex ||
    c.actorPositionBeforeHex !== hex(c.suppliedCurrentPosition) ||
    c.actorVelocityBeforeHex !== c.actorVelocityAfterHex ||
    c.deadline !== c.deadlineAfter ||
    hex([c.expectedControllerScalarB0]) !== c.correctionB0Hex ||
    hex([c.expectedControllerScalarB4]) !== c.correctionB4Hex
  )
    mismatches.push({ packet: c.sequence, result, expected: c });
}
for (const path of [
  import.meta.path,
  ...[
    "latest-fixed-time-movement.mjs",
    "latest-missiles.mjs",
    "latest-missile-controllers.mjs",
    "latest-missile-initialization.mjs",
    "latest-terrain.mjs",
    "latest-movement.mjs",
    "structural-comparison.mjs",
  ].map((n) => resolve(import.meta.dir, "..", n)),
])
  await raw(path);
const output = `${cache}/research/fixed-time-movement-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      build: native.build,
      protocol: native.protocol,
      kind: "fixed-time-movement-comparison",
      inputs,
      cases: native.cases.length,
      frames,
      firstPacketControls: native.packetControls.length,
      packetOmissions: native.packetOmissions,
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
    firstPacketControls: native.packetControls.length,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) throw Error("FixedTime native disagreement");
