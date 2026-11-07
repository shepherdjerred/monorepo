import { expect, test } from "bun:test";
import { createProjectilePresentation } from "./latest-projectile-presentation.mjs";
import {
  createLatestWorldPresentation,
  buildLatestDirectEffectEvents,
} from "./latest-world-presentation.mjs";
import { TARGETED_MISSILE_PRESENTATION_POLICY as policy } from "./latest-targeted-missile-presentation.mjs";
import { ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY } from "./latest-zero-reference-fixed-time-presentation.mjs";
const build = "16.21.829.8620",
  protocol = "20e09df23c66b85e";
const record = {
  entityId: 10,
  sequence: 1,
  time: 1,
  transportSequence: 7,
  entryOrder: 2,
  cast: { ownerId: 6, requestedTargets: [{ requestedEntityId: 8 }] },
};
const report = {
  build,
  protocol,
  replaySha256: "a".repeat(64),
  heroes: [],
  worldEvents: [],
  movement: [],
  lifecycle: [],
  attacks: [],
  casts: [],
  missiles: [record],
};
const state = (time, position, phase = 0, more = {}) => ({
  time,
  position,
  velocity: [1, 0, 0],
  phase,
  stopped: false,
  ...more,
});
const trace = {
  policy,
  instanceId: "presentation-missile:10:7:2",
  sourceEventId: "packet:7:entry:2:missile:10",
  entityId: 10,
  ownerId: 6,
  sequence: 1,
  startTime: 1,
  stopTime: null,
  requestedTargetEntityId: 8,
  nativeAcceptance: null,
  nativeAcceptedInternalId: null,
  rendered: false,
  complete: null,
  omissions: ["resource:unbound"],
  states: [
    state(1, [0, 2, 0]),
    state(2, [10, 2, 0]),
    state(2, [10, 2, 0], 1, {
      notificationSourceEventId: "phase:9:0",
      notificationTransportSequence: 9,
      notificationEntryOrder: 0,
    }),
    state(2, [10, 2, 0], 2, {
      notificationSourceEventId: "phase:9:1",
      notificationTransportSequence: 9,
      notificationEntryOrder: 1,
    }),
    state(3, [20, 2, 0], 2),
  ],
  emittedCastRequests: [
    {
      id: "missile:10:generation:7:2:cast:1",
      time: 2,
      kind: "omitted-cast-presentation-request",
      omissions: ["presentation:child-spawn"],
      rendered: false,
    },
  ],
};
const presentation = () => ({
  build,
  protocol,
  endTime: 3,
  policy,
  replaySha256: report.replaySha256,
  traces: [structuredClone(trace)],
  omitted: [],
});
const scene = {
    build,
    protocol,
    map: { min: [0, 0, 0], max: [30, 10, 30], movementOrigin: [15, 15] },
  },
  terrain = { sampleHeight: () => ({ inside: true, height: 0 }) };

test("projectile projection shares positions across world and projectile queries without guessing transforms/resources", () => {
  const world = createLatestWorldPresentation({
    report,
    scene,
    terrain,
    targetedMissilePresentation: presentation(),
  });
  expect(
    world.entity(10, 1, { transportSequence: 7, entryOrder: 1 }),
  ).toBeNull();
  expect(
    world.entity(10, 1, {
      transportSequence: 7,
      entryOrder: 2,
      exclusive: true,
    }),
  ).toBeNull();
  const entity = world.entity(10, 1.5),
    projectile = world.projectilePresentation(10, 1.5);
  expect(entity.position).toEqual([5, 2, 0]);
  expect(projectile.position).toEqual(entity.position);
  expect(world.projectile(1, 1.5)).toEqual(projectile);
  expect(entity.resourceStack).toBeNull();
  expect(entity.basis).toBeNull();
  expect(entity.nativeAcceptance).toBeNull();
  expect(world.attachment(10, 0, 1.5).resolved).toBe(false);
  expect(world.projectilePresentation(10, 3.1)).toBeNull();
  expect(world.entity(10, 3.1)).toBeNull();
  world.entity(10, 3);
  expect(world.entity(10, 1.5)).toEqual(entity);
});

test("same-time repeated phase samples respect packet entry cutoffs", () => {
  const projectiles = createProjectilePresentation(report, presentation());
  expect(
    projectiles.query(10, 2, {
      transportSequence: 9,
      entryOrder: 0,
      exclusive: true,
    }).phase,
  ).toBe(0);
  expect(
    projectiles.query(10, 2, { transportSequence: 9, entryOrder: 0 }).phase,
  ).toBe(1);
  expect(
    projectiles.query(10, 2, { transportSequence: 9, entryOrder: 1 }).phase,
  ).toBe(2);
  expect(projectiles.query(10, 2).phase).toBe(2);
});

test("generated projectile contract rejects stale identities, invalid poses and ambiguous registration", () => {
  expect(() =>
    createProjectilePresentation(report, {
      ...presentation(),
      replaySha256: "b".repeat(64),
    }),
  ).toThrow("Matching");
  for (const change of [
    { entityId: 11 },
    { ownerId: 7 },
    { requestedTargetEntityId: 9 },
    { instanceId: "foreign-generation" },
    { sourceEventId: "foreign-origin" },
    { nativeAcceptance: true },
    { states: [state(1, [null, 2, 0])] },
    { states: [state(1, [0, 2, 0]), state(0, [1, 2, 0])] },
  ]) {
    expect(() =>
      createProjectilePresentation(report, {
        ...presentation(),
        traces: [{ ...trace, ...change }],
      }),
    ).toThrow();
  }
  expect(() =>
    createProjectilePresentation(report, {
      ...presentation(),
      traces: [trace, trace],
    }),
  ).toThrow("identity");
});

test("projectile queries isolate target state and original report ownership", () => {
  const input = presentation(),
    localReport = structuredClone(report);
  input.traces[0].states[0].targetPosition = [20, 3, 0];
  const projectiles = createProjectilePresentation(localReport, input);
  const before = projectiles.query(10, 1);
  before.targetPosition[0] = 999;
  input.traces[0].states[0].targetPosition[0] = 888;
  localReport.missiles[0].transportSequence = 999;
  expect(projectiles.query(10, 1).targetPosition).toEqual([20, 3, 0]);
  expect(
    projectiles.query(10, 1, { transportSequence: 7, entryOrder: 2 }),
  ).not.toBeNull();
});

test("holder-free FixedTime identity requires an explicit empty source reference and null presentation target", () => {
  const zeroReport = structuredClone(report);
  zeroReport.missiles[0].cast.targetCount = 0;
  zeroReport.missiles[0].cast.requestedTargets = [];
  const zero = presentation();
  zero.policy = ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY;
  Object.assign(zero.traces[0], {
    policy: zero.policy,
    requestedTargetEntityId: null,
    selectedInternalId: 0,
    holderPresent: false,
    authoredTracksTarget: true,
    presentationHandle: null,
    presentationTargetId: null,
  });
  expect(
    createProjectilePresentation(zeroReport, zero).query(10, 1.5).targetId,
  ).toBeNull();
  for (const mutate of [
    (z) => (z.traces[0].requestedTargetEntityId = 0),
    (z) => (z.traces[0].selectedInternalId = 1),
    (z) => (z.traces[0].holderPresent = true),
    (z) => (z.traces[0].authoredTracksTarget = false),
    (z) => (z.traces[0].presentationHandle = "generated:target"),
    (z) => (z.traces[0].presentationTargetId = 1),
  ]) {
    const z = structuredClone(zero);
    mutate(z);
    expect(() => createProjectilePresentation(zeroReport, z)).toThrow(
      "identity required",
    );
  }
  expect(() => createProjectilePresentation(report, zero)).toThrow(
    "identity required",
  );
});

test("generated phase casts retain the triggering packet and entry", () => {
  const input = presentation();
  input.traces[0].emittedCastRequests[0].trigger = {
    kind: "decoded-phase-notification",
    transportSequence: 9,
    entryOrder: 3,
  };
  const events = buildLatestDirectEffectEvents({
    pipeline: { events: [] },
    report,
    targetedMissilePresentation: input,
  });
  const cast = events.find((event) => event.origin === "missile-behavior");
  expect(cast.transportSequence).toBe(9);
  expect(cast.entryOrder).toBe(3);
  expect(cast.orderingProvenance).toBe("decoded-trigger-packet-and-entry");
});

test("shared lifecycle ledger keeps motion readiness and emitted requests as explicit omissions", () => {
  const events = buildLatestDirectEffectEvents({
    pipeline: { events: [] },
    report,
    targetedMissilePresentation: presentation(),
  });
  expect(events).toHaveLength(2);
  expect(events[0].kind).toBe("omitted");
  expect(events[0].motionPresentation.instanceId).toBe(trace.instanceId);
  expect(events[0].reasons).toContain(
    "world:missile-root-basis-and-activation",
  );
  expect(events[1].id).toBe(trace.emittedCastRequests[0].id);
  expect(events[1].origin).toBe("missile-behavior");
  expect(events[1].kind).toBe("omitted");
  expect(events[1].rendered).toBe(false);
});
