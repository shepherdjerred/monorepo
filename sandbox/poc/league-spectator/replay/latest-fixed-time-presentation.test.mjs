import { expect, test } from "bun:test";
import {
  compileFixedTimeSpec,
  compileDefaultGravitySolver,
} from "./latest-fixed-time-spec.mjs";
import { buildFixedTimePresentation } from "./latest-fixed-time-presentation.mjs";
import { createFixedTimeMovement } from "./latest-fixed-time-movement.mjs";
import { createLatestMissileMotion } from "./latest-missiles.mjs";
import { createLatestMissileControllers } from "./latest-missile-controllers.mjs";
import { createLatestMissileActors } from "./latest-missile-actors.mjs";
import { createPresentationMissileActors } from "./latest-presentation-missile-actors.mjs";
import { PRESENTATION_TARGET_POLICY } from "./latest-presentation-targets.mjs";
const read = async (name) =>
  Bun.file(
    new URL(
      `../../../../.cache/replay-spike/public/decoder-16.21-macos/missile-${name}.json`,
      import.meta.url,
    ),
  ).json();
const motionDefinition = await read("motion"),
  motion = createLatestMissileMotion(motionDefinition),
  controllers = createLatestMissileControllers(await read("controllers")),
  actors = createPresentationMissileActors(
    createLatestMissileActors(await read("actors")),
  ),
  kernel = createFixedTimeMovement(motion, controllers);
const common = compileFixedTimeSpec(
  { __type: "FixedTimeMovement", mTravelTime: 0.4, mTargetHeightAugment: 7 },
  motionDefinition,
).settings;
const record = () => ({
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
  settings: common,
  controllerScalarB0: Math.fround(3.4028234663852886e38),
  controllerScalarB4: 0,
  cast: {
    ownerId: 5,
    spellHash: 4,
    targetCount: 1,
    requestedTargets: [{ requestedEntityId: 6 }],
    overrideFlag14d: 0,
    indexedOverrideCount: 0,
  },
  packetInitialization: {
    status: "initialized-position-fields",
    currentPosition: [0, 0, 0],
    initialPosition: [0, 0, 0],
    targetPosition: [100, 20, 0],
    targetHeightAugment: 7,
    movementSpeed: 500,
  },
  startInitialization: { status: "initialized", position: [0, 0, 0] },
  targetInitialization: { status: "initialized" },
  uninterpretedMovementFields: [],
  heightController: compileDefaultGravitySolver({
    __type: "GravityHeightSolver",
    mGravity: 3000,
  }),
  verticalFacingType: "VeritcalFacingMatchVelocity",
  verticalFacingProperties: [],
  targetBoneName: "",
  behaviorSpecs: [
    { __type: "CastOnMovementComplete" },
    { __type: "DestroyOnMovementComplete" },
  ],
});
const view = (time) => ({
  policy: PRESENTATION_TARGET_POLICY,
  resolved: true,
  presentationEligible: time < 1.2,
  presentationTargetId: 2,
  presentationHandle: "generated:6:creation:7",
  position: [time < 1.1 ? 100 : 130, 20, 0],
  visible: true,
  radius: 0,
  assumptions: [],
  omissions: ["native-acceptance-unknown"],
  sourceEventIds: [],
  visibilitySourceEventIds: [],
});
const run = (
  row = record(),
  events = [],
  endTime = 3,
  query = (id, time) => view(time),
  replications = [row],
) =>
  buildFixedTimePresentation({
    records: [row],
    eventIndex: {
      identities: [{ entityId: row.entityId, replications, events }],
    },
    world: { presentationTarget: query },
    actors,
    kernel,
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    endTime,
  });

test("FixedTime spec uses its own travel field and typed original gravity defaults", () => {
  expect(common.mTravelTime).toBe(Math.fround(0.4));
  expect(common.mTracksTarget).toBe(true);
  expect(common.mSpeed).toBeUndefined();
  expect(
    compileFixedTimeSpec(
      { __type: "FixedTimeMovement", mSpeed: 20 },
      motionDefinition,
    ).unknown,
  ).toEqual(["mSpeed"]);
  expect(
    compileFixedTimeSpec({ __type: "FixedTimeMovement" }, motionDefinition)
      .settings.mTravelTime,
  ).toBe(0);
  expect(() =>
    compileFixedTimeSpec(
      { __type: "FixedTimeMovement", mTravelTime: null },
      motionDefinition,
    ),
  ).toThrow("mTravelTime");
  expect(() =>
    compileFixedTimeSpec(
      { __type: "FixedTimeMovement", mTargetBoneName: null },
      motionDefinition,
    ),
  ).toThrow("Typed");
  expect(
    compileDefaultGravitySolver({ __type: "GravityHeightSolver" }),
  ).toMatchObject({ resolved: true, gravity: 0, nativeSpecByte10: false });
  expect(
    compileDefaultGravitySolver({ __type: "GravityHeightSolver", unknown: 1 })
      .resolved,
  ).toBe(false);
});
test("FixedTime retained-target trace follows moving known poses and emits one attributed completion request", () => {
  const a = run(),
    b = run();
  expect(a).toEqual(b);
  expect(a.traces).toHaveLength(1);
  const trace = a.traces[0];
  expect(trace.states.some((row) => row.targetPosition[0] === 130)).toBe(true);
  expect(trace.emittedCastRequests).toHaveLength(1);
  expect(trace.stopTime).toBeGreaterThan(1.4);
  expect(trace.states.at(-1).position).toEqual([130, 27, 0]);
  expect(trace.nativeAcceptance).toBeNull();
  expect(trace.rendered).toBe(false);
});
test("FixedTime prefix boundaries and identical-time notifications retain distinct entries", () => {
  let queries = 0;
  const query = (id, time) => {
    queries++;
    return view(time);
  };
  expect(run(record(), [], 0.5, query).traces).toHaveLength(0);
  expect(queries).toBe(0);
  expect(run(record(), [], 1, query).traces[0].states).toHaveLength(1);
  const events = [0, 1].map((entryOrder) => ({
    time: 1.1,
    transportSequence: 22,
    entryOrder,
    opcode: 56,
    target: 1,
  }));
  const trace = run(record(), events).traces[0];
  expect(
    trace.states.filter(
      (row) => row.time === 1.1 && !row.notificationSourceEventId,
    ),
  ).toHaveLength(1);
  expect(
    new Set(
      trace.states
        .filter((row) => row.notificationSourceEventId)
        .map((row) => row.notificationSourceEventId),
    ).size,
  ).toBe(2);
  expect(trace.emittedCastRequests).toHaveLength(1);
});
test("FixedTime refuses missing override producer, repeated replication and unavailable target/height dependencies", () => {
  for (const change of [
    { cast: { ...record().cast, indexedOverrideCount: undefined } },
    { cast: { ...record().cast, indexedOverrideCount: 1 } },
    { elapsedSeconds: 1 },
    { targetBoneName: "bone" },
    { heightController: { resolved: false, reason: "height:unknown" } },
    { settings: { ...common, mStartDelay: 1 } },
    { pendingChildren: 1 },
    { startInitialization: { status: "initialized", position: [1, 0, 0] } },
    {
      packetInitialization: {
        ...record().packetInitialization,
        targetHeightAugment: 8,
      },
    },
  ])
    expect(run({ ...record(), ...change }).traces).toHaveLength(0);
  const row = record();
  expect(run(row, [], 3, undefined, [row, row]).traces).toHaveLength(0);
  expect(
    run(row, [], 3, () => ({ ...view(1), resolved: false, position: null }))
      .traces,
  ).toHaveLength(0);
  expect(
    run(row, [], 3, (id, time) =>
      time < 1.1 ? view(time) : { ...view(time), position: null },
    ).traces,
  ).toHaveLength(0);
});

test("future replication and presentation records cannot change an earlier inclusive prefix", () => {
  const row = record(),
    future = { ...row, time: 4, transportSequence: 40 };
  const events = [
    { time: 4, transportSequence: -1, entryOrder: -1, opcode: 99, value: 1 },
  ];
  expect(run(row, events, 3, undefined, [row, future])).toEqual(run(row));
  expect(run(row, events, 4, undefined, [row, future]).traces).toHaveLength(0);
  expect(run({ ...row, entryOrder: -1 }).traces).toHaveLength(0);
  expect(
    run(row, [
      {
        time: 1.1,
        transportSequence: 21,
        entryOrder: -1,
        opcode: 56,
        target: 1,
      },
    ]).traces,
  ).toHaveLength(0);
});

test("decoded phase triggers retain exact ordinals and same-time state bounds fail explicitly", () => {
  const event = {
    time: 1.1,
    transportSequence: 22,
    entryOrder: 3,
    opcode: 56,
    target: 1,
  };
  expect(
    run(record(), [event]).traces[0].emittedCastRequests[0].trigger,
  ).toMatchObject({ transportSequence: 22, entryOrder: 3 });
  const many = Array.from({ length: 16001 }, (_, entryOrder) => ({
    ...event,
    entryOrder,
  }));
  expect(() => run(record(), many)).toThrow("bounded window");
});
