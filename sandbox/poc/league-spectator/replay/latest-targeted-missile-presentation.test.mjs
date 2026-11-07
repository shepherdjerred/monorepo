import { expect, test } from "bun:test";
import { createLatestMissileMotion } from "./latest-missiles.mjs";
import { createLatestMissileControllers } from "./latest-missile-controllers.mjs";
import { createLatestMissileFrame } from "./latest-missile-frame.mjs";
import { createLatestMissileActors } from "./latest-missile-actors.mjs";
import { createPresentationMissileActors } from "./latest-presentation-missile-actors.mjs";
import { buildTargetedMissilePresentation } from "./latest-targeted-missile-presentation.mjs";
import { PRESENTATION_TARGET_POLICY } from "./latest-presentation-targets.mjs";
import { sampleLatestMissileTrace } from "./latest-missile-playback.mjs";
import { matchVelocityVerticalFacing } from "./latest-match-velocity-facing.mjs";
import { createProjectilePresentation } from "./latest-projectile-presentation.mjs";
import { compileTrackingFixedSpeedEffectBasisProgram } from "./latest-missile-effect-basis.mjs";
const read = async (name) =>
  Bun.file(
    new URL(
      `../../../../.cache/replay-spike/public/decoder-16.21-macos/missile-${name}.json`,
      import.meta.url,
    ),
  ).json();
const motion = createLatestMissileMotion(await read("motion")),
  definition = await read("controllers"),
  controllers = createLatestMissileControllers(definition);
const frame = createLatestMissileFrame(definition, motion, controllers, null),
  actors = createPresentationMissileActors(
    createLatestMissileActors(await read("actors")),
  );
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
  movementType: "FixedSpeedMovement",
  settings: {
    mTracksTarget: true,
    mVisualsTrackHiddenTargets: false,
    mUseHeightOffsetAtEnd: false,
    mStartDelay: 0,
  },
  controllerScalarB0: Math.fround(3.4028234663852886e38),
  controllerScalarB4: 0,
  cast: {
    ownerId: 5,
    targetCount: 1,
    requestedTargets: [{ requestedEntityId: 6 }],
  },
  packetInitialization: {
    status: "initialized-position-fields",
    currentPosition: [0, 0, 0],
    initialPosition: [0, 0, 0],
    targetPosition: [100, 20, 0],
    targetHeightAugment: 7,
    movementSpeed: 100,
  },
  uninterpretedMovementFields: [],
  heightController: { status: "none", type: null, settings: null },
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
  presentationEligible: time < 1.05,
  presentationTargetId: 2,
  presentationHandle: "generated-target:6:creation:7",
  position: [time < 1.1 ? 100 : 120, 20, 0],
  visible: true,
  radius: 0,
  assumptions: ["declared-no-local-player-view"],
  omissions: ["native-acceptance-unknown"],
  sourceEventIds: ["base-flags:1"],
  visibilitySourceEventIds: ["initial822:1"],
});
const run = (
  row = record(),
  events = [],
  query = (id, time) => view(time),
  endTime = 3,
  replications = [row],
) =>
  buildTargetedMissilePresentation({
    analysis: {
      build: "16.21.829.8620",
      protocol: "20e09df23c66b85e",
      records: [row],
      eventIndex: {
        identities: [{ entityId: row.entityId, replications, events }],
      },
    },
    world: { presentationTarget: query },
    frame,
    motion,
    actors,
    endTime,
  });

test("prefix rebuilds exclude future creations and include only the initial state at the boundary", () => {
  let queries = 0;
  const query = (id, time) => {
    queries++;
    return view(time);
  };
  const before = run(record(), [], query, 0.5);
  expect(before.traces).toHaveLength(0);
  expect(before.omitted).toHaveLength(0);
  expect(queries).toBe(0);
  const at = run(record(), [], query, 1);
  expect(at.traces).toHaveLength(1);
  expect(at.traces[0].states).toHaveLength(1);
  expect(at.traces[0].emittedCastRequests).toHaveLength(0);
  const after = run();
  expect(after.traces[0].states.length).toBeGreaterThan(1);
  expect(run(record(), [], query, 1)).toEqual(at);
  const omitted = run({ ...record(), targetBoneName: "bone", entryOrder: 3 });
  expect(omitted.omitted[0].sourceEventId).toBe("packet:20:entry:3:missile:10");
});

test("tracked presentation follows known poses after initial targetability changes and seeks deterministically", () => {
  const a = run(),
    b = run();
  expect(a.summary.traces).toBe(1);
  expect(a).toEqual(b);
  const trace = a.traces[0];
  expect(trace.states.some((state) => state.targetPosition[0] === 120)).toBe(
    true,
  );
  expect(trace.states[0].targetPosition[1]).toBe(27);
  expect(trace.emittedCastRequests).toHaveLength(1);
  expect(trace.targetSourceEventIds).toEqual(["base-flags:1", "initial822:1"]);
  expect(trace.nativeAcceptance).toBeNull();
  expect(trace.nativeAcceptedInternalId).toBeNull();
  expect(trace.rendered).toBe(false);
  expect(trace.complete).toBeNull();
  const late = sampleLatestMissileTrace(trace, 2),
    early = sampleLatestMissileTrace(trace, 1.1);
  expect(sampleLatestMissileTrace(trace, 2)).toEqual(late);
  expect(sampleLatestMissileTrace(trace, 1.1)).toEqual(early);
  expect(frame.eligibility(record()).reasons).toEqual([
    "target-tracking",
    "target-reference-list",
    "vertical-facing",
  ]);
});

test("constructor velocity matches four original numeric fixtures without querying future target state", async () => {
  const native = await Bun.file(
    new URL(
      "../../../../.cache/replay-spike/research/v38-basis-preintegration/tracking-fixed-speed-basis-native-v38.json",
      import.meta.url,
    ),
  ).json();
  const hex = (value) =>
    Buffer.from(Float32Array.from(value).buffer).toString("hex");
  for (const example of native.cases) {
    const init = example.initializer,
      row = record();
    row.packetInitialization = {
      ...row.packetInitialization,
      currentPosition: init.position,
      initialPosition: init.position,
      targetPosition: init.targetPosition,
      targetHeightAugment: 0,
      movementSpeed: init.movementSpeed,
    };
    let queries = 0;
    const result = run(
      row,
      [],
      (id, time) => {
        expect(time).toBe(row.time);
        queries++;
        return { ...view(time), position: init.targetPosition };
      },
      row.time,
    );
    expect(queries).toBe(1);
    expect(hex(result.traces[0].states[0].velocity)).toBe(
      init.originalInitializerVelocityHex,
    );
    expect(result.traces[0].states[0].position).toEqual(init.position);
  }
});

test("tracking birth basis is causal, retained on stopping, and source-family checked when serialized", () => {
  const row = record();
  row.definitionName = "fixture";
  row.cast.spellHash = 123;
  row.effectBasisProgram = compileTrackingFixedSpeedEffectBasisProgram(
    {
      mCastType: 1,
      mMissileSpec: {
        __type: "MissileSpecification",
        movementComponent: {
          __type: "FixedSpeedMovement",
          mStartBoneName: "installed-bone",
        },
      },
    },
    { spellHash: 123, spellName: "fixture", catalogSha256: "a".repeat(64) },
  );
  const result = run(row),
    replaySha256 = "b".repeat(64),
    report = {
      build: result.build,
      protocol: result.protocol,
      replaySha256,
      endTime: 3,
      missiles: [row],
    },
    presentation = { ...result, replaySha256 },
    trace = result.traces[0];
  expect(trace.states[0].velocity.some((lane) => lane !== 0)).toBe(true);
  expect(trace.states[0].effectBasis).toHaveLength(9);
  const stop = trace.states.findIndex((state) => state.stopped);
  expect(stop).toBeGreaterThan(0);
  expect(trace.states[stop].effectBasis).toEqual(
    trace.states[stop - 1].effectBasis,
  );
  const projectiles = createProjectilePresentation(report, presentation);
  expect(
    projectiles.query(10, 1, {
      transportSequence: 20,
      entryOrder: 0,
      exclusive: true,
    }),
  ).toBeNull();
  const first = projectiles.query(10, 1);
  expect(first.basis).toEqual(trace.states[0].effectBasis);
  projectiles.query(10, 2);
  expect(projectiles.query(10, 1)).toEqual(first);
  const changed = structuredClone(presentation);
  changed.traces[0].effectBasisProgram.movementType = "FixedTimeMovement";
  expect(() => createProjectilePresentation(report, changed)).toThrow();
});

test("future replications and unresolved notifications cannot poison an earlier prefix", () => {
  const row = record(),
    endTime = 1.2;
  const baseline = run(row, [], undefined, endTime);
  const future = [
    { time: 2, opcode: 99, presentationByte: 1 },
    { time: 2.1, opcode: 56 },
  ];
  expect(
    run(row, future, undefined, endTime, [row, { ...row, time: 2 }]),
  ).toEqual(baseline);
  expect(
    run(row, [], undefined, 3, [row, { ...row, time: 2 }]).traces,
  ).toHaveLength(0);
});

test("ordered same-time phase then stop retain distinct source events", () => {
  const events = [
    {
      time: 1.1,
      sequence: 2,
      transportSequence: 22,
      entryOrder: 1,
      opcode: 497,
    },
    {
      time: 1.1,
      sequence: 2,
      transportSequence: 22,
      entryOrder: 0,
      opcode: 56,
      target: 1,
    },
  ];
  const trace = run(record(), events).traces[0];
  expect(trace.emittedCastRequests).toHaveLength(1);
  expect(trace.emittedCastRequests[0].time).toBe(1.1);
  expect(
    trace.states
      .filter((state) => state.notificationSourceEventId)
      .map((state) => state.notificationSourceEventId),
  ).toEqual([
    `${trace.instanceId}:packet:22:entry:0:opcode:56`,
    `${trace.instanceId}:packet:22:entry:1:opcode:497`,
  ]);
  expect(trace.emittedCastRequests[0].trigger.id).toBe(
    `${trace.instanceId}:packet:22:entry:0:opcode:56`,
  );
});

test("repeated same-op notifications in one packet retain their entry identity even without another action", () => {
  const events = [0, 1].map((entryOrder) => ({
    id: `original:${entryOrder}`,
    time: 1.1,
    sequence: 2,
    transportSequence: 22,
    entryOrder,
    opcode: 56,
    target: 1,
  }));
  const trace = run(record(), events).traces[0],
    notifications = trace.states.filter(
      (state) => state.notificationSourceEventId,
    );
  expect(trace.emittedCastRequests).toHaveLength(1);
  expect(notifications).toHaveLength(2);
  expect(
    new Set(notifications.map((state) => state.notificationSourceEventId)).size,
  ).toBe(2);
  expect(
    notifications.map((state) => state.notificationOriginalEventId),
  ).toEqual(["original:0", "original:1"]);
  expect(trace.emittedCastRequests[0].trigger.originalEventId).toBe(
    "original:0",
  );
});

test("builder-to-world projection excludes future same-time notifications without an untagged post state", () => {
  const row = record(),
    events = [
      {
        time: 1.1,
        sequence: 2,
        transportSequence: 22,
        entryOrder: 0,
        opcode: 56,
        target: 1,
      },
      {
        time: 1.1,
        sequence: 2,
        transportSequence: 22,
        entryOrder: 1,
        opcode: 56,
        target: 1,
      },
      {
        time: 1.1,
        sequence: 2,
        transportSequence: 22,
        entryOrder: 2,
        opcode: 497,
      },
    ];
  const result = run(row, events),
    replaySha256 = "a".repeat(64);
  const projectiles = createProjectilePresentation(
    {
      build: result.build,
      protocol: result.protocol,
      replaySha256,
      endTime: 3,
      missiles: [row],
    },
    { ...result, replaySha256 },
  );
  const before = projectiles.query(row.entityId, 1.1, {
    transportSequence: 22,
    entryOrder: 0,
    exclusive: true,
  });
  expect(before.phase).toBe(0);
  expect(before.stopped).toBe(false);
  expect(
    result.traces[0].states.filter(
      (state) => state.time === 1.1 && !state.notificationSourceEventId,
    ),
  ).toHaveLength(1);
  for (const entryOrder of [0, 1, 2]) {
    const query = projectiles.query(row.entityId, 1.1, {
      transportSequence: 22,
      entryOrder,
    });
    expect(query.phase).toBe(1);
    expect(query.stopped).toBe(true);
    expect(query.notificationEntryOrder).toBe(entryOrder);
  }
  expect(
    projectiles.query(row.entityId, 1.1, {
      transportSequence: 22,
      entryOrder: 0,
      exclusive: true,
    }),
  ).toEqual(before);
});

test("missing actual poses and generation changes block the instance instead of detaching", () => {
  for (const replacement of [
    {
      ...view(2),
      resolved: false,
      position: null,
      reasons: ["world-position-unknown"],
    },
    { ...view(2), presentationHandle: "another-generation" },
  ]) {
    const result = run(record(), [], (id, time) =>
      time < 1.1 ? view(time) : replacement,
    );
    expect(result.traces).toHaveLength(0);
    expect(result.omitted[0].reasons).toContain(
      "target:retained-generation-or-actual-pose-unresolved",
    );
  }
  expect(
    run(record(), [], () => ({ ...view(1), presentationEligible: false }))
      .traces,
  ).toHaveLength(0);
});

test("targeted family preserves initialization, bone, child, correction and behavior gates", () => {
  const changes = [
    { elapsedSeconds: 1 },
    { pendingChildren: 1 },
    { replicationPhase: 1 },
    { targetBoneName: "target-bone" },
    { targetBoneName: null },
    { controllerScalarB4: 1 },
    { stream: 2 },
    { verticalFacingProperties: ["unknown"] },
    { behaviorSpecs: [{ __type: "CastOnHit" }] },
  ];
  for (const change of changes) {
    const result = run({ ...record(), ...change });
    expect(result.traces).toHaveLength(0);
    expect(result.omitted[0].reasons.length).toBeGreaterThan(0);
  }
  expect(matchVelocityVerticalFacing([0, 10, 0], 0)).toBe(0);
  expect(matchVelocityVerticalFacing([0, 10, 0], Math.fround(1e-9))).toBe(0);
  expect(matchVelocityVerticalFacing([0, 10, 0], 2)).toBe(5);
  expect(() => matchVelocityVerticalFacing([0, null, 0], 1)).toThrow("float32");
});

test("stopped traces cannot bypass the retained-state bound with same-time notifications", () => {
  const events = Array.from({ length: 16000 }, (_, entryOrder) => ({
    time: 1.1,
    transportSequence: 22,
    entryOrder,
    opcode: 497,
  }));
  expect(() => run(record(), events)).toThrow("bounded diagnostic window");
});
