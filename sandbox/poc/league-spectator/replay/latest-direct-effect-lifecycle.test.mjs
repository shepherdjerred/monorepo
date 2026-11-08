import { expect, test } from "bun:test";
import {
  DIRECT_LIFECYCLE_MAX_FLOAT as MAX,
  directEmitterLinkTimers,
  directParentSchedule,
  directEmitterStopDecision,
  directEmitterTailLifetimes,
  directEmitterTailCompletion,
  directParentCompletion,
  directParentCollection,
  compileDirectEmitterLifecycle,
  createDirectEmitterLifecycleState,
  beginDirectEmitterLifecycle,
  finishDirectEmitterLifecycle,
} from "./latest-direct-effect-lifecycle.mjs";

const clock = {
  time: 1,
  clockOrigin: 0,
  timeOffset: 0,
  timeScale: 1,
  previousTime: 0,
  frequency: 30,
  authoredFlags: 212,
  parentInputFlags: 0,
  maxSubsteps: 20,
};
test("parent scheduling preserves f32 accumulation and authored cadence independently of runtime flags", () => {
  const result = directParentSchedule(clock);
  expect(result.count).toBe(15);
  expect(result.step).toBe(Math.fround(2 / 30));
  let expected = 0;
  for (let i = 0; i < 15; i++) expected = Math.fround(expected + result.step);
  expect(result.nextTime).toBe(expected);
  expect(directParentSchedule({ ...clock, time: 0 }).substeps).toEqual([0]);
  expect(
    directParentSchedule({ ...clock, time: 0, authoredFlags: 0 }).substeps,
  ).toEqual([]);
  expect(
    directParentSchedule({ ...clock, parentInputFlags: 4 }).substeps,
  ).toEqual([1]);
  expect(directParentSchedule({ ...clock, authoredFlags: 8 }).substeps).toEqual(
    [1],
  );
});

test("link timer defaults and authored caps preserve the original MAX sentinel", () => {
  expect(
    directEmitterLinkTimers({
      particleLifetime: 0.5,
      lifetime: 2,
      particleLinger: 0,
      emitterLinger: 0,
    }),
  ).toEqual([0, 0]);
  expect(
    directEmitterLinkTimers({
      particleLifetime: 0.5,
      lifetime: MAX,
      particleLinger: 10.6,
      emitterLinger: MAX,
    }),
  ).toEqual([10.5, MAX]);
});

test("mode-false can complete with live particles while a linger tail remains conditional", () => {
  const input = {
    time: 1,
    parentFlags: 0x80a0,
    lifetime: 2,
    stopTime: 0,
    actorFlags: 4,
    emitterFlags: 0,
    linkControllerCount: 1,
  };
  const decision = directEmitterStopDecision(input);
  expect(decision.stopRequested).toBe(true);
  const particles = [
    [0.9, 0.5],
    [0.8, 0.5],
  ];
  const stopped = directEmitterTailLifetimes({
    lingerType: 0,
    parentFlags: input.parentFlags,
    stopRequested: true,
    previousStopTime: -1,
    time: 1,
    cutoff: 0,
    particles,
  });
  expect(stopped.after).toEqual([Math.fround(0.9), 0, Math.fround(0.8), 0]);
  expect(particles).toEqual([
    [0.9, 0.5],
    [0.8, 0.5],
  ]);
  expect(
    directEmitterTailCompletion(5, 1, [
      [0.9, 0],
      [0.8, 0],
    ]),
  ).toBe(5);
  expect(
    directParentCompletion(0x80a0, {
      complexFlags: [5],
      simpleComplete: [],
      meshComplete: [],
    }),
  ).toBe(0x80a2);
  expect(
    directParentCollection({
      parentFlags: 0x80a2,
      queued: true,
      managerForce: false,
      force: false,
    }),
  ).toBe(true);
  expect(directEmitterTailCompletion(5, 1, particles)).toBe(4);
});

test("type1/2 tail lifespan is authored once from the first stop clock and uses a strict deadline", () => {
  const input = {
    lingerType: 2,
    parentFlags: 0,
    stopRequested: true,
    previousStopTime: -1,
    time: 2,
    cutoff: 0.75,
    particles: [[0.5, 5]],
  };
  expect(directEmitterTailLifetimes(input)).toEqual({
    stopTime: 2,
    after: [0.5, 2.25],
  });
  expect(directEmitterTailLifetimes({ ...input, previousStopTime: 1 })).toEqual(
    { stopTime: 1, after: [0.5, 5] },
  );
  expect(directEmitterTailCompletion(5, 2.75, [[0.5, 2.25]])).toBe(4);
  expect(
    directEmitterTailCompletion(5, Math.fround(2.75 + 2 ** -22), [[0.5, 2.25]]),
  ).toBe(5);
});

test("unknown runtime flags, clocks, or sparse particle pairs are rejected rather than defaulted", () => {
  for (const key of Object.keys(clock))
    expect(() =>
      directParentSchedule({ ...clock, [key]: undefined }),
    ).toThrow();
  for (const frequency of [0, 1e-50, Infinity, "30", null])
    expect(() => directParentSchedule({ ...clock, frequency })).toThrow();
  expect(() => directParentSchedule({ ...clock, previousTime: 2 })).toThrow(
    "Monotonic",
  );
  for (const particles of [
    new Array(1),
    [new Array(2)],
    [[0, null]],
    [[0, "1"]],
  ])
    expect(() => directEmitterTailCompletion(5, 1, particles)).toThrow();
  expect(() =>
    directParentCollection({
      parentFlags: undefined,
      queued: true,
      managerForce: false,
      force: false,
    }),
  ).toThrow();
  for (const key of ["complexFlags", "simpleComplete", "meshComplete"])
    expect(() =>
      directParentCompletion(0x8000, {
        complexFlags: [],
        simpleComplete: [],
        meshComplete: [],
        [key]: new Array(1),
      }),
    ).toThrow("sibling completion");
});

test("retained controller uses a separate local birth lane and never rewrites absolute presentation clocks", () => {
  const program = compileDirectEmitterLifecycle(
    {
      particleLifetime: { __type: "ValueFloat", constantValue: 0.3 },
      lifetime: 1,
    },
    "camera-quad",
  );
  const state = createDirectEmitterLifecycleState(program, null);
  const decision = beginDirectEmitterLifecycle(program, state, {
    time: 0.2,
    parentFlags: 0x80a0,
  });
  const data = new Float32Array(20);
  data[0] = 69.1;
  data[1] = 0.3;
  data[19] = 0.1;
  const absolute = data[0];
  expect(
    finishDirectEmitterLifecycle(program, state, {
      time: 0.2,
      parentFlags: 0x80a0,
      decision,
      emitted: true,
      data,
      count: 1,
      birthClockLane: 19,
    }),
  ).toBe(true);
  expect(data[0]).toBe(absolute);
  expect(data[1]).toBe(0);
  expect(state.actorFlags).toBe(5);
  expect(
    beginDirectEmitterLifecycle(program, state, {
      time: 0.2,
      parentFlags: 0x80a0,
    }).skip,
  ).toBe(true);
  expect(() =>
    finishDirectEmitterLifecycle(program, state, {
      time: 0.2,
      parentFlags: 0x80a0,
      decision,
      emitted: false,
      data,
      count: 1,
      birthClockLane: 1,
    }),
  ).toThrow();
});

test("bounded controller compilation never invents a resource-curve maximum or single-link state", () => {
  const valid = {
    particleLifetime: { __type: "ValueFloat", constantValue: 0.3 },
    lifetime: 1,
  };
  for (const primitive of ["camera-quad", "arbitrary-quad"])
    expect(compileDirectEmitterLifecycle(valid, primitive)).not.toBeNull();
  expect(compileDirectEmitterLifecycle(valid, "camera-trail")).toBeNull();
  for (const value of [
    null,
    undefined,
    { __type: "ValueFloat", constantValue: 0.3, dynamics: {} },
    { __type: "ValueFloat", constantValue: 0 },
  ])
    expect(
      compileDirectEmitterLifecycle(
        { ...valid, particleLifetime: value },
        "camera-quad",
      ),
    ).toBeNull();
  for (const change of [
    { particleLinger: undefined },
    { particleLinger: -1 },
    { emitterLinger: "0" },
    { particleLingerType: 3 },
    { period: MAX },
    { isSingleParticle: "true" },
  ])
    expect(
      compileDirectEmitterLifecycle({ ...valid, ...change }, "camera-quad"),
    ).toBeNull();
  const single = compileDirectEmitterLifecycle(
    { ...valid, isSingleParticle: true },
    "camera-quad",
  );
  expect(() => createDirectEmitterLifecycleState(single, null)).toThrow(
    "explicit link-controller",
  );
  expect(createDirectEmitterLifecycleState(single, 0).actorFlags).toBe(0);
});
