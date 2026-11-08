import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike");
const root = resolve(import.meta.dir, "..");
const inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`);
const packageBytes = await raw(
  `${cache}/public/latest-trail-particles/package.json`,
);
const meta = JSON.parse(new TextDecoder().decode(packageBytes));
const native = await read(`${cache}/research/trail-particles-native.json`);
if (
  (await sha256(image)) !== profile.decoderImageSha256 ||
  meta.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.packageSha256 !== (await sha256(packageBytes)) ||
  native.observerSha256 !==
    (await sha256(await raw(`${root}/tools/observe-trail-particles.py`)))
)
  throw Error("Original complete trail observation contract differs");
for (const [name, expected] of Object.entries(native.compilerSources))
  if ((await sha256(await raw(`${root}/tools/${name}`))) !== expected)
    throw Error(`Stale complete trail evidence source: ${name}`);
for (const block of native.originalBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Observed original trail instructions changed");
await raw(import.meta.path);
const floats = (hex) => {
  const bytes = Uint8Array.fromHex(hex),
    view = new DataView(bytes.buffer);
  return (offset) => view.getFloat32(offset, true);
};
const f = Math.fround;
const cases = native.cases.filter(
  (entry) =>
    entry.effectId === "champions/vladimir/39/9fbafd14" &&
    [0, 1, 9].includes(entry.emitterIndex),
);
if (cases.length !== 9)
  throw Error(
    "Three emitters with three original supplied-input modes required",
  );
let births = 0,
  retainedFrameChecks = 0;
const results = [];
for (const entry of cases) {
  const template = meta.templates.find(
    (value) =>
      value.effectId === entry.effectId &&
      value.emitterIndex === entry.emitterIndex,
  );
  if (
    !template ||
    template.sha256 !== entry.graphSha256 ||
    (await sha256(
      await raw(`${cache}/public/latest-trail-particles/${template.file}`),
    )) !== template.sha256
  )
    throw Error("Compared complete CameraTrail graph changed");
  let previous = null,
    distance = 0,
    count = 0;
  for (const frame of entry.frames) {
    const state = frame.output.state,
      odometer = floats(state.vectors.odometer.hex);
    if (state.births.length > state.vectors.odometer.count)
      throw Error("Births escaped retained trail pool");
    for (const [index, birth] of state.births.entries()) {
      const value = floats(birth.birthHex),
        position = [value(0x30), value(0x34), value(0x38)];
      if (previous) {
        const delta = position.map((coordinate, lane) =>
          f(coordinate - previous[lane]),
        );
        const squared = f(
          f(delta[2] * delta[2]) +
            f(f(delta[0] * delta[0]) + f(delta[1] * delta[1])),
        );
        distance = f(distance + f(Math.sqrt(squared)));
      }
      previous = position;
      const nativeDistance = odometer(
        (state.vectors.odometer.count - state.births.length + index) * 4,
      );
      if (!Object.is(nativeDistance, distance))
        throw Error(
          `Retained birth odometer differs: ${entry.emitterIndex}:${frame.input.time}`,
        );
      births++;
      count++;
    }
    if (previous) {
      if (!Object.is(floats(state.actorHex)(0xb4), distance))
        throw Error("Native actor odometer did not retain the last birth sum");
      retainedFrameChecks++;
    }
  }
  results.push({
    effectId: entry.effectId,
    emitterIndex: entry.emitterIndex,
    mode: entry.mode,
    seedHex: entry.seedHex,
    births: count,
    finalDistance: distance,
    matched: true,
  });
}
const ranges = [
  [0x175a84a, 0x175aa06],
  [0x176dca0, 0x176dd01],
  [0x175d030, 0x175d506],
  [0x177aa70, 0x177aa78],
  [0x23f6648, 0x23f6650],
];
const blocks = await Promise.all(
  ranges.map(async ([startRva, endRva]) => ({
    startRva,
    endRva,
    sha256: await sha256(image.subarray(startRva, endRva)),
  })),
);
if (
  Number(
    new DataView(image.buffer, image.byteOffset).getBigUint64(0x23f6648, true),
  ) !== 0x10177aa70
)
  throw Error("CameraTrail stable-removal virtual target changed");
for (const [path, expected] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error(`Trail proof input changed: ${path}`);
const output = `${cache}/research/trail-birth-state-evidence.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      build: profile.clientVersion,
      protocol: profile.protocolDigest,
      decoderImageSha256: profile.decoderImageSha256,
      inputs,
      blocks,
      counts: { cases: cases.length, births, retainedFrameChecks },
      results,
      mismatchCount: 0,
      sourceOrder: [
        "birth-position-transform",
        "frame-chance-or-authored-clock",
        "retained-birth-distance",
        "frame-curve-with-shared-chance",
        "primitive-birth-tiling-with-shared-chance",
      ],
      stableRemoval: {
        dispatcherRva: 0x175d030,
        primitiveVirtualOffset: 0x128,
        cameraTrailTargetRva: 0x177aa70,
        originalReturn: true,
        branchRva: 0x175d08a,
        tilingShiftRva: 0x175d1c2,
        odometerShiftRva: 0x175d20f,
        ordinalShiftRva: 0x175d25c,
        attributesShiftRva: 0x175d2a9,
      },
      scope: {
        originalSuppliedInputBirthObservationsCompared: true,
        retainedDistanceBitExact: true,
        stableRemovalInstructionEvidenceOnly: true,
        deathTransitionExecuted: false,
        actualReplayBindingsVerified: false,
        mainViewerExpanded: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    cases: cases.length,
    births,
    retainedFrameChecks,
    inputFingerprintsVerified: Object.keys(inputs).length,
  }),
);
