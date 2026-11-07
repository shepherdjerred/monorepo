import { expect, test } from "bun:test";
import {
  ROFL_ALL_VISION_POLICY,
  createLatestVisibilityComponentPolicy,
  initialVisibilityComponentState,
  applyVisibilityComponentEvent,
  decodeVisibilityViewSlot,
  queryVisibilityComponent,
} from "./latest-target-visibility-policy.mjs";
import { createLatestWorldPresentation } from "./latest-world-presentation.mjs";
import { INITIAL_VISIBILITY_PREFIX_POLICY } from "./latest-initial-visibility-prefix.mjs";

const build = "16.21.829.8620",
  protocol = "20e09df23c66b85e";
const event = (opcode, order, fields = {}) => ({
  id: `request:${order}`,
  opcode,
  entityId: 61,
  stream: 1,
  time: 4,
  transportSequence: order,
  entryOrder: 0,
  acceptedByLiveUnit: null,
  visible: null,
  ...fields,
});
const registration = {
  entityId: 61,
  presentationHandle: "generated:61:10",
  componentClass: "ai-client",
  creationTime: 4,
  creationTransportSequence: 10,
};
const cursor = (transportSequence, exclusive = false) => ({
  transportSequence,
  entryOrder: 0,
  exclusive,
});
const create = (requests, fields = {}) =>
  createLatestVisibilityComponentPolicy({
    build,
    protocol,
    policy: ROFL_ALL_VISION_POLICY,
    requests,
    ...fields,
  });
const queryInputs = {
  mode: 3,
  querySelectedView: true,
  viewFilterEnabled: false,
  selectedViewSlot: null,
  sentinelSlot: null,
};

test("native component masks and resets remain distinct from declared all-vision queries", () => {
  let state = initialVisibilityComponentState();
  expect(queryVisibilityComponent(state, queryInputs)).toBe(false);
  expect(decodeVisibilityViewSlot(0x1e)).toBe(1);
  expect(decodeVisibilityViewSlot(0x1a)).toBe(2);
  state = applyVisibilityComponentEvent(
    state,
    { opcode: 48, encodedViewSlotByte: 0x1e },
    3,
  );
  expect(state.mask).toBe(2);
  expect(queryVisibilityComponent(state, queryInputs)).toBe(false);
  state = applyVisibilityComponentEvent(state, { opcode: 822 }, 3);
  expect(queryVisibilityComponent(state, queryInputs)).toBe(true);
  const cleared = applyVisibilityComponentEvent(
    state,
    { opcode: 582, encodedViewSlotByte: 0x1e },
    3,
  );
  expect(cleared.mask).toBe(0);
  expect(queryVisibilityComponent(cleared, queryInputs)).toBe(true);
  expect(
    applyVisibilityComponentEvent(cleared, { opcode: 918 }, 3).initialized,
  ).toBe(true);
  expect(
    applyVisibilityComponentEvent(cleared, { opcode: 918 }, 0).initialized,
  ).toBe(false);
  expect(
    queryVisibilityComponent(
      { ...cleared, override: true, initialized: false },
      { ...queryInputs, mode: 0 },
    ),
  ).toBe(true);
  expect(
    queryVisibilityComponent(
      { ...cleared, override: true, initialized: false },
      queryInputs,
    ),
  ).toBe(false);
});

test("same-time packet ordering, repeated requests and backward seeks preserve provenance", () => {
  const policy = create([
    event(582, 14, { encodedViewSlotByte: 0x1e }),
    event(822, 12),
    event(48, 11, { encodedViewSlotByte: 0x1e }),
    event(822, 13),
    event(918, 15),
  ]);
  expect(policy.query(registration, 4, cursor(10)).state).toEqual(
    initialVisibilityComponentState(),
  );
  expect(policy.query(registration, 4, cursor(12, true))).toMatchObject({
    nativeVisibilityResult: false,
    state: { mask: 2 },
    sourceEventIds: ["request:11"],
  });
  const after = policy.query(registration, 4);
  expect(after).toMatchObject({
    nativeVisibilityResult: true,
    state: { initialized: true, mask: 0 },
    nativeAcceptedInternalId: null,
    nativeAcceptance: null,
    complete: null,
  });
  expect(after.sourceEventIds).toEqual([
    "request:11",
    "request:12",
    "request:13",
    "request:14",
    "request:15",
  ]);
  const before = policy.query(registration, 4, cursor(12, true));
  expect(before.nativeVisibilityResult).toBe(false);
  expect(policy.query(registration, 4)).toEqual(after);
  expect(after.omissions).toContain(
    "visibility:original-world-component-registration-not-replayed",
  );
});

test("component class, causal activation, removal and reused identity generations gate the policy", () => {
  const policy = create([
    event(822, 9),
    event(48, 12, { encodedViewSlotByte: 0x1a }),
    event(822, 20),
  ]);
  expect(policy.query(null, 4).resolved).toBe(false);
  expect(
    policy.query({ ...registration, componentClass: "building" }, 4).resolved,
  ).toBe(false);
  expect(policy.query(registration, 4, cursor(10, true)).resolved).toBe(false);
  expect(policy.query(registration, 4, cursor(12))).toMatchObject({
    nativeVisibilityResult: false,
    ignoredBeforeGeneration: ["request:9"],
    state: { mask: 4 },
  });
  const removed = {
    ...registration,
    removalTime: 4,
    removalTransportSequence: 18,
  };
  expect(policy.query(removed, 4, cursor(18, true)).resolved).toBe(true);
  expect(policy.query(removed, 4, cursor(18)).resolved).toBe(false);
  const reused = {
    ...registration,
    presentationHandle: "generated:61:19",
    creationTransportSequence: 19,
  };
  expect(policy.query(reused, 4, cursor(19))).toMatchObject({
    nativeVisibilityResult: false,
    ignoredBeforeGeneration: ["request:9", "request:12"],
  });
  expect(policy.query(reused, 4, cursor(20)).nativeVisibilityResult).toBe(true);
});

test("snapshot requests stay separate until component restoration is implemented", () => {
  const policy = create([
    event(822, 11, { stream: 2 }),
    event(48, 12, {
      stream: 2,
      encodedViewSlotByte: 0x1e,
    }),
    event(822, 13),
  ]);
  expect(policy.query(registration, 4, cursor(12))).toMatchObject({
    nativeVisibilityResult: false,
    sourceEventIds: [],
    ignoredSnapshotEventIds: ["request:11", "request:12"],
    state: { mask: 0 },
  });
  expect(policy.query(registration, 4, cursor(13))).toMatchObject({
    nativeVisibilityResult: true,
    sourceEventIds: ["request:13"],
    ignoredSnapshotEventIds: ["request:11", "request:12"],
  });
  expect(() => create([event(822, 12, { stream: undefined })])).toThrow();
});

test("only an explicit verified seed for the same presentation generation can initialize state", () => {
  const seed = {
    id: "verified-seed",
    entityId: 61,
    presentationHandle: registration.presentationHandle,
    time: 4,
    transportSequence: 12,
    entryOrder: 0,
    provenance: "explicit-verified-component-observation",
    evidenceSha256: "a".repeat(64),
    sourceEventIds: ["native-observation-source"],
    state: { ...initialVisibilityComponentState(), initialized: true, mask: 4 },
  };
  const policy = create(
    [
      event(48, 11, { encodedViewSlotByte: 0x1e }),
      event(582, 13, { encodedViewSlotByte: 0x1a }),
    ],
    { seedObservations: [seed] },
  );
  seed.state.initialized = false;
  expect(policy.query(registration, 4, cursor(12, true))).toMatchObject({
    nativeVisibilityResult: false,
    state: { mask: 2 },
    componentSeed: null,
  });
  expect(policy.query(registration, 4, cursor(12))).toMatchObject({
    nativeVisibilityResult: true,
    state: { mask: 4 },
    ignoredBeforeSeed: ["request:11"],
    componentSeed: {
      id: "verified-seed",
      sourceEventIds: ["native-observation-source"],
    },
  });
  expect(policy.query(registration, 4, cursor(13)).state.mask).toBe(0);
  expect(
    policy.query(
      { ...registration, presentationHandle: "another-generation" },
      4,
    ).nativeVisibilityResult,
  ).toBe(false);
  expect(() =>
    create([], { seedObservations: [{ ...seed, provenance: "raw-snapshot" }] }),
  ).toThrow();
  expect(() =>
    create([], { seedObservations: [{ ...seed, evidenceSha256: null }] }),
  ).toThrow();
  expect(() =>
    create([], {
      seedObservations: [{ ...seed, state: { ...seed.state, schema: 0 } }],
    }),
  ).toThrow();
});

test("declared initial restore translates only a matching causally registered initial AI-client prefix", () => {
  const initialRegistration = {
    ...registration,
    creationTime: 0,
    creationStream: 2,
    creationChunkId: 1,
    creationSourceKind: "hero-creation-candidate",
  };
  const primary = event(822, 12, { stream: 2, time: 0, chunkId: 1 });
  const late = event(822, 20, { stream: 2, time: 60, chunkId: 7 });
  const policy = create([primary, late], {
    initialRestorePolicy: INITIAL_VISIBILITY_PREFIX_POLICY,
  });
  expect(
    policy.query(initialRegistration, 0, cursor(12, true))
      .nativeVisibilityResult,
  ).toBe(false);
  const after = policy.query(initialRegistration, 0, cursor(12));
  expect(after).toMatchObject({
    nativeVisibilityResult: true,
    sourceEventIds: ["request:12"],
    initialRestorePrefixEvents: [
      {
        id: "request:12",
        presentationHandle: registration.presentationHandle,
        provenance:
          "translated-original-component-prefix-before-owner-callback",
      },
    ],
    componentSeed: null,
    nativeAcceptedInternalId: null,
    nativeAcceptance: null,
  });
  expect(after.initialRestoreProof.ownerCallbackExecuted).toBe(false);
  expect(policy.query(initialRegistration, 99)).toMatchObject({
    nativeVisibilityResult: true,
    sourceEventIds: ["request:12"],
    ignoredSnapshotEventIds: ["request:20"],
  });
  expect(policy.query(initialRegistration, 0, cursor(12))).toEqual(after);
  for (const change of [
    { creationStream: 1 },
    { creationChunkId: 2 },
    { creationTime: 1 },
    { creationSourceKind: "unproven" },
    { creationTransportSequence: 12 },
  ]) {
    const result = policy.query({ ...initialRegistration, ...change }, 99);
    expect(result.nativeVisibilityResult).toBe(false);
    expect(result.initialRestorePrefixEvents).toHaveLength(0);
  }
  expect(() =>
    create([], { initialRestorePolicy: "restore-all-snapshots" }),
  ).toThrow();
});

test("malformed types and ambiguous order never become policy defaults", () => {
  for (const value of [-1, 256, 0.5, "30", null])
    expect(() => decodeVisibilityViewSlot(value)).toThrow();
  expect(() => create([], { build: "other" })).toThrow();
  expect(() => create([], { policy: "actual-team-view" })).toThrow();
  expect(() =>
    create([event(822, 12), event(918, 12, { id: "another" })]),
  ).toThrow();
  expect(() =>
    create([event(822, 12, { acceptedByLiveUnit: true })]),
  ).toThrow();
  expect(() => create([event(48, 12)])).toThrow();
  expect(() =>
    create([event(822, 12, { transportSequence: undefined })]),
  ).toThrow();
  expect(() =>
    create([]).query(registration, 4, { transportSequence: 12 }),
  ).toThrow();
  expect(() =>
    queryVisibilityComponent(
      { ...initialVisibilityComponentState(), initialized: true },
      { ...queryInputs, viewFilterEnabled: true },
    ),
  ).toThrow();
});

test("actual decoded world identities expose diagnostic policy while original visibility stays unknown", () => {
  const scene = {
    build,
    protocol,
    map: { min: [0, 0, 0], max: [10, 1, 10], movementOrigin: [5, 5] },
  };
  const report = {
    build,
    protocol,
    heroes: [
      {
        entityId: 61,
        champion: "ArbitrarySharedAiClient",
        skinId: 0,
        creationPosition: [1, 2, 3],
        provenance: { time: 4, transportSequence: 10 },
      },
    ],
    worldEvents: [],
    movement: [],
    lifecycle: [],
    attacks: [],
    casts: [],
    missiles: [],
    visibilityRequests: [event(822, 12)],
  };
  const world = createLatestWorldPresentation({
    report,
    scene,
    terrain: { sampleHeight: () => ({ inside: true, height: 2 }) },
  });
  expect(world.visibility(61, 4, cursor(10, true)).resolved).toBe(false);
  expect(world.visibility(61, 4, cursor(12, true)).nativeVisibilityResult).toBe(
    false,
  );
  expect(world.visibility(61, 4, cursor(12))).toMatchObject({
    policy: ROFL_ALL_VISION_POLICY,
    nativeVisibilityResult: true,
    presentationHandle: "presentation-ai:61:10:0",
    nativeAcceptedInternalId: null,
    nativeAcceptance: null,
  });
  expect(world.entity(61, 4).visibility).toBe("unknown");
  expect(world.visibility(999, 4).resolved).toBe(false);
});
