// Compare browser-compatible controller frames to complete original routines.
// This CLI never launches a browser or League.
import { resolve } from "node:path";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { createLatestMissileMotion } from "../latest-missiles.mjs";
import { createLatestMissileControllers } from "../latest-missile-controllers.mjs";
import { createLatestMissileFrame } from "../latest-missile-frame.mjs";
import { createLatestMissileActors } from "../latest-missile-actors.mjs";

const [packagePath, scenePath, missilePath, nativePath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-missile-frames.mjs <decoder> <scene> <missiles.json> <native-frames.json> <evidence.json>",
  );
const decoder = resolve(packagePath),
  scene = resolve(scenePath),
  profile = await Bun.file(`${decoder}/profile.json`).json(),
  definitionBytes = await Bun.file(
    `${decoder}/missile-controllers.json`,
  ).arrayBuffer(),
  motionBytes = await Bun.file(`${decoder}/missile-motion.json`).arrayBuffer(),
  manifestBytes = await Bun.file(`${scene}/manifest.json`).arrayBuffer(),
  heights = await Bun.file(`${scene}/heights.bin`).arrayBuffer(),
  missileBytes = await Bun.file(missilePath).arrayBuffer(),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  decode = (b) => JSON.parse(new TextDecoder().decode(b)),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  missiles = decode(missileBytes),
  native = decode(nativeBytes),
  manifest = decode(manifestBytes);
if (
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  native.build !== manifest.build ||
  native.protocol !== manifest.protocol ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.fieldCodecsSha256 !== profile.fieldCodecsSha256 ||
  native.controllerDefinitionSha256 !== hash(definitionBytes) ||
  hash(definitionBytes) !== profile.missileControllersSha256 ||
  native.motionDefinitionSha256 !== hash(motionBytes) ||
  hash(motionBytes) !== profile.missileMotionSha256 ||
  native.missileInputsSha256 !== hash(missileBytes) ||
  native.sceneManifestSha256 !== hash(manifestBytes) ||
  native.heightsSha256 !== hash(heights) ||
  native.services.powf.originalMacosImplementationVerified !== false
)
  throw Error("Missile frame comparison source mismatch");
const definition = decode(definitionBytes),
  frame = createLatestMissileFrame(
    definition,
    createLatestMissileMotion(decode(motionBytes)),
    createLatestMissileControllers(definition),
    createLatestTerrain(manifest, new Float32Array(heights)),
  ),
  bits = (n) => new Uint32Array(new Float32Array([n]).buffer)[0],
  vectorBits = (v) => [...new Uint32Array(new Float32Array(v).buffer)],
  canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value,
  same = (a, b) =>
    JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)),
  mismatches = [],
  records = new Map(missiles.records.map((r) => [r.sequence, r])),
  coverage = new Map(),
  representativeTraces = [];
let actors = null;
if (native.actorDefinitionSha256) {
  const bytes = await Bun.file(`${decoder}/missile-actors.json`).arrayBuffer();
  if (
    hash(bytes) !== native.actorDefinitionSha256 ||
    hash(bytes) !== profile.missileActorsSha256 ||
    missiles.missileActorsSha256 !== profile.missileActorsSha256
  )
    throw Error("Flight actor definition mismatch");
  actors = createLatestMissileActors(decode(bytes));
}
const eligible = missiles.records.filter(
  (r) =>
    !frame.eligibility(r).reasons.length &&
    (!actors ||
      (!actors.settings(r.behaviorSpecs).reasons.length &&
        r.pendingChildren === 0)),
);
let framesMatched = 0,
  historyAtCapacity = 0,
  arrivedCases = 0,
  stoppedCases = 0;
for (const sample of native.cases) {
  const record = records.get(sample.sequence);
  if (
    !record ||
    sample.payloadSha256 !== record.payloadSha256 ||
    sample.entityId !== record.entityId
  )
    throw Error("Native frame record does not match input");
  const state = frame.initialize(record),
    actorState = actors?.initialize(record),
    expectedInitial = {
      positionBits: vectorBits(state.position),
      initialPositionBits: vectorBits(state.initialPosition),
      targetPositionBits: vectorBits(state.targetPosition),
      speedBits: bits(state.speed),
      correctionBits: bits(record.controllerScalarB0),
      correctionDeltaBits: bits(record.controllerScalarB4),
      arrivalRadiusBits: bits(state.radius),
      targetRef: 0,
      canPassOnce: state.canPassOnce,
    };
  if (actors) expectedInitial.actorState = actors.snapshot(actorState);
  const spellIdentity = `${record.ownerCharacter}/${record.definitionName}`,
    trace =
      sample.seconds === Math.fround(1 / 60) &&
      !representativeTraces.some((t) => t.spell === spellIdentity)
        ? {
            spell: spellIdentity,
            sequence: record.sequence,
            elapsedSeconds: record.elapsedSeconds,
            source: [...state.position],
            target: [...state.targetPosition],
            frames: [],
          }
        : null;
  if (trace) representativeTraces.push(trace);
  if (!same(expectedInitial, sample.initial))
    mismatches.push({
      sequence: sample.sequence,
      seconds: sample.seconds,
      phase: "initialization",
      actual: expectedInitial,
      expected: sample.initial,
    });
  const schedules = coverage.get(record.sequence) ?? new Set();
  if (schedules.has(sample.seconds))
    throw Error("Repeated native frame schedule");
  schedules.add(sample.seconds);
  coverage.set(record.sequence, schedules);
  for (const [index, expected] of sample.frames.entries()) {
    const update = frame.step(state, expected.time, sample.seconds),
      actual = {
        time: expected.time,
        velocityBits: vectorBits(update.velocity),
        displacementBits: vectorBits(update.displacement),
        speedBits: bits(update.speed),
        arrived: update.arrived,
        canPassOnce: update.canPassOnce,
        historySize: update.historySize,
        historySha256: hash(new Float32Array(state.history.flat())),
        positionBits: vectorBits(update.position),
        appliedVelocityBits: vectorBits(update.appliedVelocity),
      };
    if (actors) {
      actorState.velocity = [...update.appliedVelocity];
      actors.afterMovement(actorState, update.arrived);
      actual.actorState = actors.snapshot(actorState);
      state.velocity = [...actorState.velocity];
    }
    if (trace)
      trace.frames.push({
        time: expected.time,
        browserPosition: [...update.position],
        nativePosition: [
          ...new Float32Array(new Uint32Array(expected.positionBits).buffer),
        ],
        arrived: update.arrived,
        ...(actors
          ? {
              actor: {
                browser: {
                  phase: actual.actorState.phase,
                  stopped: actual.actorState.stopped,
                  velocity: [...actual.actorState.velocity],
                },
                native: {
                  phase: expected.actorState.phase,
                  stopped: expected.actorState.stopped,
                  velocity: [...expected.actorState.velocity],
                },
              },
            }
          : {}),
      });
    if (!same(actual, expected)) {
      mismatches.push({
        sequence: sample.sequence,
        seconds: sample.seconds,
        index,
        actual,
        expected,
      });
      // A disagreement invalidates the sequence; do not flood evidence with
      // downstream consequences of the same first frame difference.
      break;
    }
    framesMatched++;
    if (update.historySize === 60) historyAtCapacity++;
  }
  if (state.arrived) arrivedCases++;
  if (actorState?.stopped) stoppedCases++;
}
if (
  native.cases.length !== eligible.length * 5 ||
  eligible.some((r) => coverage.get(r.sequence)?.size !== 5)
)
  throw Error("Native/browser frame admission or coverage disagreement");
const sourceNames = [
  "latest-missile-frame.mjs",
  "latest-missiles.mjs",
  "latest-missile-controllers.mjs",
  "latest-terrain.mjs",
];
if (actors) sourceNames.push("latest-missile-actors.mjs");
const sources = Object.fromEntries(
  await Promise.all(
    sourceNames.map(async (name) => [
      name,
      hash(
        await Bun.file(new URL(`../${name}`, import.meta.url)).arrayBuffer(),
      ),
    ]),
  ),
);
const evidence = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  decoderImageSha256: native.decoderImageSha256,
  fieldCodecsSha256: native.fieldCodecsSha256,
  controllerDefinitionSha256: hash(definitionBytes),
  motionDefinitionSha256: hash(motionBytes),
  missileInputsSha256: hash(missileBytes),
  nativeEvidenceSha256: hash(nativeBytes),
  initializationEvidenceSha256: native.initializationEvidenceSha256,
  terrainEvidenceSha256: native.terrainEvidenceSha256,
  sources,
  eligibleRecords: eligible.length,
  positiveElapsedRecords: eligible.filter((r) => r.elapsedSeconds > 0).length,
  boundSpells: [
    ...new Set(eligible.map((r) => `${r.ownerCharacter}/${r.definitionName}`)),
  ],
  cases: native.cases.length,
  frames: native.cases.reduce((n, c) => n + c.frames.length, 0),
  framesMatched,
  arrivedCases,
  historyAtCapacity,
  ...(actors
    ? { actorDefinitionSha256: native.actorDefinitionSha256, stoppedCases }
    : {}),
  services: native.services,
  representativeTraces,
  mismatches,
  scope: actors
    ? "Original controller frames/apply and native post-movement phase/component fragment agree with browser-compatible composition on owned no-child snapshots. Supplied clock, bounds, presentation-stop and Windows powf adapters. No owner/type prefilters, collision/hit/cast/child dispatch, actual phase timing, particle lifetime, rendered A/V or reference playback"
    : "Complete original no-target controller frames and applied position/velocity match browser-compatible translation at supplied clocks. Windows CRT powf adapter, skipped bounds notifications, no actor collisions/phase/lifetime, rendered A/V or original playback comparison",
};
await Bun.write(outputPath, JSON.stringify(evidence, null, 2));
console.log(
  JSON.stringify({
    eligibleRecords: eligible.length,
    cases: evidence.cases,
    frames: evidence.frames,
    framesMatched,
    arrivedCases,
    historyAtCapacity,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length)
  throw Error("Native/browser complete controller frame disagreement");
