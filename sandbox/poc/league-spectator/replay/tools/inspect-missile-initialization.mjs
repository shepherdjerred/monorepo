// Compare start/packet initialization fields without admitting full playback.
import { resolve } from "node:path";
import { createLatestMissileInitialization } from "../latest-missile-initialization.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";

const [decoderPath, scenePath, missilePath, nativePath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-missile-initialization.mjs <decoder-dir> <scene-dir> <missile-analysis> <native-initialization> <evidence>",
  );
const decoder = resolve(decoderPath),
  scene = resolve(scenePath),
  profile = await Bun.file(`${decoder}/profile.json`).json(),
  definitionBytes = await Bun.file(
    `${decoder}/missile-controllers.json`,
  ).arrayBuffer(),
  manifest = await Bun.file(`${scene}/manifest.json`).json(),
  heights = new Float32Array(
    await Bun.file(`${scene}/heights.bin`).arrayBuffer(),
  ),
  missileBytes = await Bun.file(missilePath).arrayBuffer(),
  missiles = JSON.parse(new TextDecoder().decode(missileBytes)),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  native.build !== manifest.build ||
  native.protocol !== manifest.protocol ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.fieldCodecsSha256 !== profile.fieldCodecsSha256 ||
  native.controllerDefinitionSha256 !== profile.missileControllersSha256 ||
  hash(definitionBytes) !== profile.missileControllersSha256 ||
  hash(missileBytes) !== native.missileInputsSha256 ||
  native.nativeObjectsBound !== missiles.records.length
)
  throw Error("Native initialization comparison package mismatch");
const initialization = createLatestMissileInitialization(
    JSON.parse(new TextDecoder().decode(definitionBytes)),
  ),
  terrain = createLatestTerrain(manifest, heights),
  records = new Map(missiles.records.map((r) => [r.sequence, r])),
  scalarBits = (n) => new Uint32Array(new Float32Array([n]).buffer)[0],
  vectorBits = (n) => Array.from(new Uint32Array(new Float32Array(n).buffer)),
  equalVector = (a, b) =>
    JSON.stringify(vectorBits(a)) === JSON.stringify(vectorBits(b)),
  startMismatches = [],
  packetMismatches = [],
  selectorMismatches = [];
let packetVariants = 0,
  positiveElapsedStarts = 0,
  positiveElapsedPackets = 0;
for (const sample of native.cases) {
  const record = records.get(sample.sequence);
  if (
    !record ||
    record.payloadSha256 !== sample.payloadSha256 ||
    record.entityId !== sample.entityId ||
    record.startInitialization.status !== "initialized"
  )
    throw Error("Native initialization source differs from recorded missile");
  const expected = record.startInitialization,
    actual = sample.start;
  if (
    !equalVector(actual.position, expected.position) ||
    !equalVector(actual.localOffset, expected.localOffset) ||
    actual.groundRebase !== expected.groundRebase ||
    scalarBits(actual.planeHeightOffset) !==
      scalarBits(expected.planeHeightOffset) ||
    scalarBits(actual.attachmentHeightOffset) !==
      scalarBits(expected.attachmentHeightOffset)
  )
    startMismatches.push({ sequence: sample.sequence, actual, expected });
  if (record.elapsedSeconds > 0) positiveElapsedStarts++;
  const packet = record.packetInitialization;
  if (
    packet.status === "initialized-position-fields" &&
    sample.packetVariants.length !== 2
  )
    throw Error(
      "Native packet initialization lacks both attachment-flag probes",
    );
  if (sample.packetVariants.length && record.elapsedSeconds > 0)
    positiveElapsedPackets++;
  for (const variant of sample.packetVariants) {
    packetVariants++;
    const translated = initialization.initializeFixedSpeedPacket(
      record,
      record.settings,
      expected,
      record.targetInitialization,
      terrain,
    );
    for (const output of [packet, translated]) {
      if (
        output.status !== "initialized-position-fields" ||
        !equalVector(variant.initialPosition, output.initialPosition) ||
        !equalVector(variant.targetPosition, output.targetPosition) ||
        scalarBits(variant.targetHeightAugment) !==
          scalarBits(output.targetHeightAugment) ||
        scalarBits(variant.movementSpeed) !== scalarBits(output.movementSpeed)
      ) {
        packetMismatches.push({
          sequence: sample.sequence,
          variant,
          expected: output,
        });
        break;
      }
    }
  }
}
if (
  native.cases.length !== missiles.summary.initializedRecordedStarts ||
  packetVariants !== missiles.summary.initializedFixedSpeedPacketPositions * 2
)
  throw Error("Native initialization comparison coverage mismatch");
const selectorSeed = missiles.records.find(
  (r) => r.startInitialization.status === "initialized",
);
if (!selectorSeed && native.selectorCases.length)
  throw Error("Missing source seed for selector diagnostics");
for (const sample of native.selectorCases) {
  const record = {
      ...selectorSeed,
      cast: {
        ...selectorSeed.cast,
        overrideFlag14d: sample.overrideFlag14d,
        overrideScalar134: sample.overrideScalar134,
      },
    },
    actual = initialization.initializeStart(
      record,
      {
        mCastType: sample.castType,
        mParticleStartOffset: sample.particleStartOffset,
      },
      terrain,
    );
  if (
    actual.groundRebase !== sample.groundRebase ||
    !equalVector(actual.localOffset, sample.localOffset)
  )
    selectorMismatches.push({ sample, actual });
}
const evidence = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  fieldCodecsSha256: native.fieldCodecsSha256,
  controllerDefinitionSha256: native.controllerDefinitionSha256,
  nativeEvidenceSha256: hash(nativeBytes),
  missileInputsSha256: hash(missileBytes),
  initializationSourceSha256: hash(
    await Bun.file(
      new URL("../latest-missile-initialization.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  nativeObjectsBound: native.nativeObjectsBound,
  startsMatched: native.cases.length - startMismatches.length,
  packetVariantsMatched: packetVariants - packetMismatches.length,
  positiveElapsedStarts,
  positiveElapsedPackets,
  startMismatches,
  packetMismatches,
  selectorCasesMatched: native.selectorCases.length - selectorMismatches.length,
  selectorMismatches,
  scope:
    "Original selector and recorded-source start fragments plus fixed-speed packet initializer agree on admitted fields; caster/bone seeds, local offset rotation, timing, target references and complete flight/A/V remain unverified",
};
await Bun.write(outputPath, JSON.stringify(evidence, null, 2));
console.log(
  JSON.stringify({
    nativeObjectsBound: evidence.nativeObjectsBound,
    startsMatched: evidence.startsMatched,
    packetVariantsMatched: evidence.packetVariantsMatched,
    positiveElapsedStarts,
    positiveElapsedPackets,
    startMismatches: startMismatches.length,
    packetMismatches: packetMismatches.length,
    selectorCasesMatched: evidence.selectorCasesMatched,
    selectorMismatches: selectorMismatches.length,
  }),
);
if (
  startMismatches.length ||
  packetMismatches.length ||
  selectorMismatches.length
)
  throw Error("Native/browser missile initialization disagreement");
