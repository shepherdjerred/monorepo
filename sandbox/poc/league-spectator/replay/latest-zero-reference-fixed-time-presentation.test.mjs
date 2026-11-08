import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  buildZeroReferenceFixedTimePresentation,
  ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY,
} from "./latest-zero-reference-fixed-time-presentation.mjs";
import {
  compileZeroReferenceFixedTimeSpec,
  createZeroReferenceFixedTimeController,
} from "./latest-zero-reference-fixed-time.mjs";
import { createFixedTimeMovement } from "./latest-fixed-time-movement.mjs";
import { createLatestMissileMotion } from "./latest-missiles.mjs";
import { createLatestMissileControllers } from "./latest-missile-controllers.mjs";
import { createLatestMissileInitialization } from "./latest-missile-initialization.mjs";
import { createLatestMissileActors } from "./latest-missile-actors.mjs";
import { createPresentationMissileActors } from "./latest-presentation-missile-actors.mjs";
import { EMPTY_BONE_CASTER_START_POLICY } from "./latest-missile-caster-start.mjs";
const read = (name) =>
  Bun.file(
    new URL(
      `../../../../.cache/replay-spike/public/decoder-16.21-macos/missile-${name}.json`,
      import.meta.url,
    ),
  ).json();
const motionDefinition = await read("motion"),
  controllersDefinition = await read("controllers");
test("fresh module entries initialize independently without cached cycle ordering", () => {
  for (const file of [
    "latest-zero-reference-fixed-time-presentation.mjs",
    "latest-zero-reference-fixed-time.mjs",
    "latest-world-presentation.mjs",
    "latest-projectile-presentation.mjs",
  ]) {
    const url = new URL(file, import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      ["--eval", `await import(${JSON.stringify(url)})`],
      { encoding: "utf8", timeout: 3000 },
    );
    expect({
      entry: file,
      status: result.status,
      error: result.error?.message,
      stderr: result.stderr,
    }).toEqual({ entry: file, status: 0, error: undefined, stderr: "" });
  }
}, 15000);
const kernel = createFixedTimeMovement(
  createLatestMissileMotion(motionDefinition),
  createLatestMissileControllers(controllersDefinition),
);
const actors = createPresentationMissileActors(
  createLatestMissileActors(await read("actors")),
);
const terrain = {
  sampleHeight: () => ({ inside: true, height: 20 }),
  sameMovementCell: () => false,
};
const baseController = createZeroReferenceFixedTimeController({
  kernel,
  initialization: createLatestMissileInitialization(controllersDefinition),
  terrain,
});
const spec = compileZeroReferenceFixedTimeSpec(
  {
    movementComponent: {
      __type: "FixedTimeMovement",
      mTravelTime: 0.4,
      mOffsetInitialTargetHeight: 100,
    },
    heightSolver: { __type: "GravityHeightSolver", mGravity: 5000 },
    verticalFacing: { __type: "VeritcalFacingMatchVelocity" },
  },
  motionDefinition,
);
const row = () => ({
  entityId: 10,
  sequence: 1,
  transportSequence: 20,
  entryOrder: 0,
  stream: 1,
  time: 1,
  elapsedSeconds: 0,
  pendingChildren: 0,
  replicationPhase: 0,
  initialPresentationByte: 0,
  movementType: "FixedTimeMovement",
  zeroReferenceSpec: structuredClone(spec),
  movementSpeed: 9,
  controllerScalarB0: Math.fround(3.4028234663852886e38),
  controllerScalarB4: 0,
  cast: {
    ownerId: 5,
    spellHash: 4,
    targetCount: 0,
    requestedTargets: [],
    overrideFlag14d: 0,
    indexedOverrideCount: 0,
    sourcePosition: [0, 0, 0],
    targetPosition: [100, 0, 0],
  },
  startInitialization: {
    policy: EMPTY_BONE_CASTER_START_POLICY,
    resolved: true,
    status: "initialized",
    position: [0, 100, 0],
    planeHeightOffset: 0,
    attachmentHeightOffset: 0,
    omissions: ["source:test-root"],
  },
  targetInitialization: { status: "initialized" },
  packetInitialization: { status: "initialized-position-fields" },
  behaviorSpecs: [
    { __type: "CastOnMovementComplete" },
    { __type: "DestroyOnMovementComplete" },
  ],
});
function run(
  record = row(),
  events = [],
  endTime = 3,
  replications = [record],
) {
  const clocks = [];
  const controller = {
    initialize: baseController.initialize,
    step(...args) {
      clocks.push(args.slice(1));
      return baseController.step(...args);
    },
  };
  const result = buildZeroReferenceFixedTimePresentation({
    records: [record],
    eventIndex: { identities: [{ entityId: 10, replications, events }] },
    actors,
    controller,
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    endTime,
  });
  return { result, clocks };
}
test("zero-reference family retains endpoint and constructor motion without creating a target identity", () => {
  const { result, clocks } = run(),
    trace = result.traces[0];
  expect(result.policy).toBe(ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY);
  expect(result.traces).toHaveLength(1);
  expect(trace).toMatchObject({
    requestedTargetEntityId: null,
    selectedInternalId: 0,
    holderPresent: false,
    authoredTracksTarget: true,
    presentationHandle: null,
    presentationTargetId: null,
    nativeAcceptance: null,
    actualMatchMotionAccepted: false,
  });
  expect(
    trace.states.every(
      (s) => s.targetPosition[0] === 100 && s.targetPosition[1] === 120,
    ),
  ).toBe(true);
  expect(trace.stopTime).toBeGreaterThan(1.4);
  expect(trace.states.at(-1).position).toEqual([100, 120, 0]);
  expect(trace.emittedCastRequests).toHaveLength(1);
  expect(trace.sourceEventId).toBe("packet:20:entry:0:missile:10");
  expect(clocks[0]).toEqual([
    Math.fround(1 + 1 / 60),
    Math.fround(1 / 60),
    Math.fround(1 / 60),
  ]);
  expect(run().result).toEqual(result);
});
test("same-time causal notifications and subframe splits retain original global delta", () => {
  const events = [0, 1].map((entryOrder) => ({
    time: 1.01,
    transportSequence: 21,
    entryOrder,
    opcode: 56,
    target: 0,
  }));
  events.push({
    time: 1.02,
    transportSequence: 22,
    entryOrder: 0,
    opcode: 497,
  });
  const { result, clocks } = run(row(), events),
    trace = result.traces[0];
  expect(clocks[0]).toEqual([
    Math.fround(1.01),
    Math.fround(0.01),
    Math.fround(1 / 60),
  ]);
  expect(clocks.every((x) => x[2] === Math.fround(1 / 60))).toBe(true);
  expect(trace.stopTime).toBe(1.02);
  expect(
    trace.states.filter((s) => s.time === 1.01 && s.notificationSourceEventId),
  ).toHaveLength(2);
  expect(
    new Set(
      trace.states
        .filter((s) => s.notificationSourceEventId)
        .map((s) => s.notificationSourceEventId),
    ).size,
  ).toBe(3);
  expect(trace.emittedCastRequests).toHaveLength(0);
});
test("new family does not waive original identity, replication, source or controller guards", () => {
  expect(
    compileZeroReferenceFixedTimeSpec(
      {
        movementComponent: {
          __type: "FixedTimeMovement",
          mUseGroundHeightAtTarget: false,
        },
        heightSolver: { __type: "GravityHeightSolver" },
        verticalFacing: { __type: "VeritcalFacingMatchVelocity" },
      },
      motionDefinition,
    ),
  ).toMatchObject({
    resolved: false,
    reasons: ["target:original-terrain-endpoint-required"],
  });
  for (const mutate of [
    (r) => (r.cast.targetCount = 1),
    (r) => r.cast.requestedTargets.push({ requestedEntityId: 6 }),
    (r) => (r.cast.indexedOverrideCount = 1),
    (r) => (r.cast.overrideFlag14d = 1),
    (r) => (r.elapsedSeconds = 1),
    (r) => (r.pendingChildren = 1),
    (r) => (r.replicationPhase = 1),
    (r) => (r.initialPresentationByte = 1),
    (r) => (r.transportSequence = -1),
    (r) => (r.controllerScalarB4 = 1),
    (r) => (r.startInitialization.policy = "foreign"),
    (r) => (r.startInitialization.position = null),
    (r) =>
      (r.targetInitialization.status = "unresolved-facing-derived-endpoint"),
    (r) => (r.packetInitialization.status = "unresolved-start"),
    (r) => (r.zeroReferenceSpec.resolved = false),
    (r) => (r.zeroReferenceSpec.settings.mTracksTarget = false),
    (r) => (r.zeroReferenceSpec.settings.mUseGroundHeightAtTarget = false),
    (r) => r.behaviorSpecs.push({ __type: "Unknown" }),
  ]) {
    const r = row();
    mutate(r);
    expect(run(r).result.traces).toHaveLength(0);
  }
  const r = row();
  expect(run(r, [], 3, [r, r]).result.traces).toHaveLength(0);
  expect(run(row(), [], 0.5).result.traces).toHaveLength(0);
  expect(run(row(), [], 1).result.traces[0].states).toHaveLength(1);
});
