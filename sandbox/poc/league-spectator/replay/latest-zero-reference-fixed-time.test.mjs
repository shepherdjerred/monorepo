import { expect, test } from "bun:test";
import {
  createZeroReferenceFixedTimeController,
  ZERO_REFERENCE_FIXED_TIME_POLICY,
} from "./latest-zero-reference-fixed-time.mjs";

function fixture() {
  const calls = [];
  const kernel = {
    initialize(input) {
      calls.push(input);
      return {
        position: [...input.position],
        initialPosition: [...input.position],
        targetPosition: [...input.targetPosition],
        velocity: [1, 2, 3],
        speed: 5,
      };
    },
    step(state, now, delta, globalDelta) {
      calls.push({ now, delta, globalDelta });
      return state;
    },
  };
  const terrain = {
    sampleHeight: () => ({ inside: true, height: 20 }),
    sameMovementCell: () => false,
  };
  const initialization = {
    initializeFixedSpeedPacket(record, settings, start, target) {
      return {
        status: "initialized-position-fields",
        currentPosition: [...start.position],
        initialPosition: [...start.position],
        targetPosition: [...target.position],
        movementSpeed: record.movementSpeed,
      };
    },
  };
  const spec = {
    policy: ZERO_REFERENCE_FIXED_TIME_POLICY,
    resolved: true,
    selectedInternalId: 0,
    holderPresent: false,
    gravity: 5000,
    settings: {
      mTracksTarget: true,
      mUseGroundHeightAtTarget: true,
      mProjectTargetToCastRange: false,
      mUseHeightOffsetAtEnd: false,
      mStartDelay: 0,
      mTravelTime: 0.4,
      mOffsetInitialTargetHeight: 60,
    },
  };
  const record = {
    stream: 1,
    time: 4,
    elapsedSeconds: 0,
    replicationPhase: 0,
    pendingChildren: 0,
    initialPresentationByte: 0,
    controllerScalarB0: Math.fround(3.4028234663852886e38),
    controllerScalarB4: 0,
    movementSpeed: 9,
    cast: {
      targetCount: 0,
      requestedTargets: [],
      overrideFlag14d: 0,
      indexedOverrideCount: 0,
      sourcePosition: [0, 0, 0],
      targetPosition: [10, 0, 10],
    },
  };
  const start = {
    status: "initialized",
    position: [0, 100, 0],
    attachmentHeightOffset: 0,
  };
  return {
    controller: createZeroReferenceFixedTimeController({
      kernel,
      initialization,
      terrain,
    }),
    calls,
    spec,
    record,
    start,
  };
}

test("empty reference retains the authored tracking flag and constructor velocity across first packet", () => {
  const f = fixture(),
    state = f.controller.initialize(f);
  expect(f.spec.settings.mTracksTarget).toBe(true);
  expect(state.holderPresent).toBe(false);
  expect(state.selectedInternalId).toBe(0);
  expect(state.state.velocity).toEqual([1, 2, 3]);
  expect(state.beforePacket.speed).toBe(5);
  expect(state.state.speed).toBe(9);
  expect(state.state.targetPosition).toEqual([10, 80, 10]);
  expect(f.calls[0].travelTimeOverride).toBeNull();
  expect(f.controller.nativeMatchAccepted).toBe(false);
});

test("local event splits preserve the separately supplied global frame delta", () => {
  const f = fixture(),
    state = f.controller.initialize(f);
  expect(() => f.controller.step(state, 4.01, 0.01)).toThrow(
    "global frame delta",
  );
  f.controller.step(state, 4.01, 0.01, 1 / 60);
  expect(f.calls.at(-1)).toEqual({
    now: 4.01,
    delta: 0.01,
    globalDelta: 1 / 60,
  });
});

test("nonempty references, overrides and aged replication require separate original behavior", () => {
  for (const mutate of [
    (f) => (f.record.cast.targetCount = 1),
    (f) => f.record.cast.requestedTargets.push({ requestedEntityId: 7 }),
    (f) => (f.record.cast.indexedOverrideCount = 1),
    (f) => (f.record.elapsedSeconds = 1),
    (f) => (f.record.controllerScalarB4 = 1),
  ]) {
    const f = fixture();
    mutate(f);
    expect(() => f.controller.initialize(f)).toThrow(
      "Exact first zero-reference packet",
    );
    expect(f.calls.length).toBe(0);
  }
});

test("terrain endpoint admission cannot use a non-ground-height specification", () => {
  const f = fixture();
  f.spec.settings.mUseGroundHeightAtTarget = false;
  expect(() => f.controller.initialize(f)).toThrow("specification required");
  expect(f.calls).toHaveLength(0);
});

test("holder-free controller rejects endpoint mutation before the shared step", () => {
  const f = fixture(),
    state = f.controller.initialize(f);
  state.state.targetPosition[0] += 1;
  expect(() => f.controller.step(state, 5, 1 / 60)).toThrow(
    "endpoint mutation",
  );
  expect(f.calls.length).toBe(1);
});
