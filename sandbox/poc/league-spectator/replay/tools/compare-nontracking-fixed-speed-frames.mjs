// Supplied original start/end controls, never an actual live-range admission.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import {
  compileSuppliedNontrackingFixedSpeedSpec,
  createSuppliedNontrackingFixedSpeedController,
} from "../latest-nontracking-fixed-speed.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash) throw Error("Frame input changed");
  inputs[path] = hash;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(
  `${cache}/research/nontracking-fixed-speed-frames-native-v35.json`,
);
if (
  native.kind !==
    "original-supplied-input-nontracking-fixed-speed-complete-frames" ||
  native.cases.length !== 18 ||
  native.scope.actualConsumedRangeRecovered !== false ||
  native.scope.activeFamilyAdmissionChanged !== false
)
  throw Error("Complete bounded original supplied-input cohort required");
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Original frame input changed: " + path);
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
for (const block of native.blocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original frame instruction block differs");
const definition = await read(
    `${cache}/public/decoder-16.21-macos/missile-controllers.json`,
  ),
  motionDefinition = await read(
    `${cache}/public/decoder-16.21-macos/missile-motion.json`,
  ),
  manifest = await read(`${cache}/public/latest-scene/manifest.json`),
  heightBytes = await raw(`${cache}/public/latest-scene/heights.bin`),
  terrain = createLatestTerrain(
    manifest,
    new Float32Array(
      heightBytes.buffer.slice(
        heightBytes.byteOffset,
        heightBytes.byteOffset + heightBytes.byteLength,
      ),
    ),
  ),
  controller = createSuppliedNontrackingFixedSpeedController({
    motionDefinition,
    controllerDefinition: definition,
    terrain,
  }),
  catalog = await read(
    `${cache}/public/latest-scene/${manifest.champions["akshan/20"].spellCatalog}`,
  ),
  spec = compileSuppliedNontrackingFixedSpeedSpec(
    catalog.spells["43261541"].data.mMissileSpec,
    motionDefinition,
    definition,
  );
const vector = (hex) => {
    const b = Buffer.from(hex, "hex");
    return Array.from({ length: b.length / 4 }, (_, i) => b.readFloatLE(i * 4));
  },
  hex = (values) => {
    const b = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => b.writeFloatLE(v, i * 4));
    return b.toString("hex");
  };
let frames = 0,
  arrivals = 0;
const controls = [];
for (const row of native.cases) {
  const control = controller.initialize({
      record: row.record,
      start: { ...row.start, status: "initialized" },
      suppliedEndpoint: {
        position: vector(row.suppliedOriginalEndpoint.positionHex),
      },
      spec,
    }),
    state = control.state;
  if (hex(control.constructorVelocity) !== row.beforePacket.velocityHex)
    throw Error("Original constructor velocity differs");
  for (const sample of row.frames) {
    const actual = controller.step(
        control,
        sample.time,
        sample.delta,
        sample.globalDelta,
      ),
      update = hex([actual.speed, ...actual.velocity, ...actual.displacement]);
    if (
      update !== sample.updateHex.slice(0, 56) ||
      actual.arrived !== sample.arrived ||
      actual.canPassOnce !== sample.canPassOnce ||
      hex(actual.position) !== sample.positionHex ||
      hex(actual.appliedVelocity) !== sample.velocityHex ||
      state.history.length !== sample.historySize ||
      (await sha256(Buffer.from(state.history.map(hex).join(""), "hex"))) !==
        sample.historySha256
    )
      throw Error(
        `Original complete frame differs at ${row.sequence}/${row.suppliedRange}/${row.schedule}/${frames}`,
      );
    frames++;
  }
  if (!state.arrived) throw Error("Original arrival boundary required");
  arrivals++;
  controls.push({
    sequence: row.sequence,
    suppliedRange: row.suppliedRange,
    schedule: row.schedule,
    frames: row.frames.length,
  });
}
if (
  frames !== 344 ||
  arrivals !== 18 ||
  new Set(controls.map((r) => `${r.sequence}/${r.suppliedRange}/${r.schedule}`))
    .size !== 18
)
  throw Error("Full supplied-input frame cohort required");
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Frame comparison drifted");
const output = `${cache}/research/nontracking-fixed-speed-frames-comparison-v35.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "translated-supplied-input-nontracking-fixed-speed-complete-frames",
      artifactVersion: 35,
      inputs,
      cases: 18,
      frames,
      arrivals,
      mismatches: 0,
      controls,
      scope: {
        originalConstructorInitializerFirstPacketAndCompleteFrame: true,
        followTerrainAndFaceTarget: true,
        firstTickAndSuppliedInteriorSplit: true,
        bitExactIncludingSignedZero: true,
        completePositionHistory: true,
        suppliedStartAndProjectedEndpoint: true,
        actualConsumedRangeRecovered: false,
        actualMatchMotionEstablished: false,
        activeFamilyAdmissionChanged: false,
        updatePaddingCompared: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ output, cases: 18, frames, arrivals, mismatches: 0 }),
);
