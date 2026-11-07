import { expect, test } from "bun:test";
import {
  loadLatestInitialResourcePrefix,
  createLatestInitialResourcePrefix,
  INITIAL_RESOURCE_PREFIX_POLICY,
} from "./latest-initial-resource-prefix.mjs";
import {
  createLatestWorldPresentation,
  selectLatestWorldEffectResource,
} from "./latest-world-presentation.mjs";

const base = new URL(
  "../../../../.cache/replay-spike/public/",
  import.meta.url,
);
const load = (path) => Bun.file(new URL(path, base)).bytes();
const profile = await Bun.file(
  new URL("decoder-16.21-macos/profile.json", base),
).json();
const manifestBytes = await load("latest-effects/manifest.json");
const build = profile.clientVersion,
  protocol = profile.protocolDigest;
const hero = {
  kind: "hero-creation-candidate",
  entityId: 1,
  champion: "Ornn",
  skinId: 0,
  creationPosition: [0, 0, 0],
  provenance: {
    time: 0,
    stream: 2,
    chunkId: 1,
    transportSequence: 10,
    entryOrder: 0,
  },
};
const report = (requests = [], overrides = {}) => ({
  build,
  protocol,
  heroes: [structuredClone(hero)],
  resourceRequests: requests,
  movement: [],
  lifecycle: [],
  missiles: [],
  casts: [],
  attacks: [],
  ...overrides,
});
const setup = (value = report()) =>
  loadLatestInitialResourcePrefix({
    profile,
    load,
    manifestBytes,
    report: value,
  });
const cursor = (transportSequence, exclusive = false) => ({
  transportSequence,
  entryOrder: 0,
  exclusive,
});
const request = (overrides = {}) => ({
  id: "resource-request:20:0",
  origin: "network",
  opcode: 129,
  entityId: 1,
  time: 2,
  transportSequence: 20,
  entryOrder: 0,
  stream: 1,
  chunkId: 0,
  blockOffset: 100,
  status: "unit-form-selection-request",
  index: 255,
  signedIndex: -1,
  nativeFlag: false,
  acceptedByLiveUnit: null,
  resourceIdentity: null,
  ...overrides,
});

test("initial presentation source begins at exact creation cursor and preserves a stable per-generation handle", async () => {
  const { policy } = await setup();
  expect(policy.query(1, 0, cursor(10, true)).stack).toBeNull();
  const first = policy.query(1, 0, cursor(10));
  expect(first.policy).toBe(INITIAL_RESOURCE_PREFIX_POLICY);
  expect(first.stack.overlays).toEqual([]);
  expect(first.actorKey).toBe("champions/ornn/0");
  expect(first.nativeAcceptance).toBeNull();
  expect(first.nativeCacheReadiness).toBeNull();
  expect(first.liveEngineResourceState).toBeNull();
  expect(first.browserStaticPackageReady).toBe(true);
  expect(policy.query(1, 99).stack.base).toEqual(first.stack.base);
  expect(first.source).toEqual({
    entityId: 1,
    time: 0,
    stream: 2,
    chunkId: 1,
    transportSequence: 10,
    entryOrder: 0,
  });
  expect(Object.isFrozen(first.stack)).toBe(true);
});

test("a request invalidates conditionally known resources at its causal boundary and backward seeks restore the prefix", async () => {
  const value = report([request()]);
  const { policy } = await setup(value);
  value.resourceRequests[0].time = 100;
  expect(policy.query(1, 2, cursor(20, true)).stack).not.toBeNull();
  const blocked = policy.query(1, 2, cursor(20));
  expect(blocked.stack).toBeNull();
  expect(blocked.blockingRequest.id).toBe("resource-request:20:0");
  expect(blocked.blockingRequest.acceptedByLiveUnit).toBeNull();
  expect(policy.query(1, 3).stack).toBeNull();
  expect(policy.query(1, 1)).toEqual(policy.query(1, 1));
  expect(policy.query(1, 1).stack).not.toBeNull();
});

test("cached immutable prefix states keep the earliest postcreation mutation across streams and repeated seeks", async () => {
  const first = request({ stream: 2 }),
    later = request({
      time: 3,
      transportSequence: 30,
      id: "resource-request:30:0",
    }),
    unrelated = request({
      entityId: 2,
      time: 1,
      transportSequence: 15,
      id: "resource-request:15:0",
    }),
    precreation = request({
      time: 0,
      transportSequence: 9,
      id: "resource-request:9:0",
    }),
    value = report([later, unrelated, first, precreation]),
    { policy } = await setup(value),
    initial = policy.query(1, 1),
    invalidated = policy.query(1, 2, cursor(20));
  expect(initial.stack).not.toBeNull();
  expect(invalidated.blockingRequest.id).toBe(first.id);
  expect(policy.query(1, 99)).toBe(invalidated);
  expect(policy.query(1, 2, cursor(20, true))).toBe(initial);
  expect(policy.query(1, 1)).toBe(initial);
  expect(Object.isFrozen(invalidated.blockingRequest)).toBe(true);
  expect(Object.isFrozen(initial.source)).toBe(true);
  expect(() => {
    initial.stack.base.contextIdentity = 0;
  }).toThrow();
  expect(policy.query(1, 1)).toBe(initial);
  expect(policy.query(1, 0, cursor(10, true)).stack).toBeNull();
});
test("caller mutation of static metadata cannot change retained prefix bindings or backward queries", async () => {
  const { policy, contexts } = await setup();
  const expected = policy.query(1, 1);
  const context = contexts.metadata.contexts.find(
    (value) => value.identity === expected.contextIdentity,
  );
  context.actorKey = "caller/changed";
  context.name = "CallerChanged";
  context.skinId = 999;
  policy.query(1, 99);
  expect(policy.query(1, 1)).toEqual(expected);
});

test("snapshot requests do not silently renew or bypass the conditional initial state", async () => {
  const { policy } = await setup(
    report([request({ time: 0, stream: 2, chunkId: 1 })]),
  );
  expect(policy.query(1, 0, cursor(19)).stack).not.toBeNull();
  expect(policy.query(1, 0, cursor(20)).blockingRequest.stream).toBe(2);
  expect(policy.query(1, 69).stack).toBeNull();
});

test("unknown copy producers invalidate resources without becoming accepted mutations", async () => {
  const copy = request({
    opcode: 965,
    status: "appearance-stack-request",
    kind: "copy",
    sourceEntityId: 2,
  });
  const { policy } = await setup(report([copy]));
  expect(policy.query(1, 2).stack).toBeNull();
  expect(policy.query(1, 2).blockingRequest.opcode).toBe(965);
  expect(policy.query(1, 2).nativeAcceptance).toBeNull();
});

test("noninitial identities and unprepared static skins remain unresolved", async () => {
  for (const h of [
    { ...hero, skinId: 999 },
    { ...hero, provenance: { ...hero.provenance, stream: 1 } },
    { ...hero, kind: "npc-creation-candidate" },
  ]) {
    const { policy } = await setup(report([], { heroes: [h] }));
    expect(policy.query(1, 69).stack).toBeNull();
  }
  const { policy } = await setup();
  expect(policy.query(2, 69).stack).toBeNull();
  expect(() =>
    policy.query(1, 1, { transportSequence: -1, entryOrder: 0 }),
  ).toThrow("causal clock");
});

test("pinned bytes, exact builds and original request identities are required", async () => {
  const resources = await setup();
  const packageBytes = await load(
    "latest-initial-resource-prefix/package.json",
  );
  await expect(
    createLatestInitialResourcePrefix({
      ...resources,
      contexts: resources.contexts,
      resolvers: resources.resolvers,
      profile,
      packageBytes: packageBytes.slice(1),
      report: report(),
    }),
  ).rejects.toThrow("Pinned");
  await expect(
    createLatestInitialResourcePrefix({
      ...resources,
      profile: { ...profile, clientVersion: "wrong" },
      packageBytes,
      report: report(),
    }),
  ).rejects.toThrow("Unsupported");
  await expect(setup(report([request(), request()]))).rejects.toThrow(
    "Duplicate",
  );
  await expect(
    setup(report([], { resourceRequests: undefined })),
  ).rejects.toThrow("inventory");
});

test("world and resource selection retain presentation provenance without synthesizing accepted tracks", async () => {
  const r = report(),
    { policy } = await setup(r);
  const scene = {
    build,
    protocol,
    map: { min: [0, 0, 0], max: [10, 1, 10], movementOrigin: [5, 5] },
  };
  const terrain = { sampleHeight: () => ({ inside: true, height: 0 }) };
  const world = createLatestWorldPresentation({
    report: r,
    scene,
    terrain,
    initialResourcePrefix: policy,
    placementResolver({ references }) {
      const view = references.find(
        (ref) => ref.field === "resourceContextEntityId",
      ).entity;
      expect(view.resourcePresentation).toBe(policy.query(1, 1));
      expect(view.resourceStack).toBe(policy.query(1, 1).stack);
      expect(() => {
        view.resourceStack.base.id = "private-mutation";
      }).toThrow();
      return { resolved: false, reasons: ["supplied-test-placement"] };
    },
  });
  world.placement(
    {
      descriptor: {
        resourceContextEntityId: 1,
        lookupA8EntityId: 0,
        lookup14EntityId: 0,
        attachmentEntityId: 0,
      },
    },
    1,
  );
  const entity = world.entity(1, 1);
  entity.resourceStack.base.id = "caller-mutated";
  expect(world.entity(1, 1).resourceStack.base.id).not.toBe("caller-mutated");
  expect(world.entity(1, 1).resourcePresentation.nativeAcceptance).toBeNull();
  const selected = selectLatestWorldEffectResource({
    descriptor: {
      field8c: 0,
      resourceContextEntityId: 1,
      lookupA8EntityId: 0,
      lookup14EntityId: 0,
      attachmentEntityId: 0,
      resourceKey: 1,
      unresolvedAuxiliaryContextIds: [],
    },
    time: 1,
    cursor: cursor(20),
    world,
    unitResources: {
      metadata: { build, protocol },
      selectSuppliedStacks: () => ({ status: "continue-global-resolution" }),
    },
  });
  expect(selected.presentation.policy).toBe(INITIAL_RESOURCE_PREFIX_POLICY);
  expect(selected.presentation.units[0].sourceEventId).toBe(
    "hero-creation:1:10:0",
  );
  expect(() =>
    createLatestWorldPresentation({
      report: r,
      scene,
      terrain,
      initialResourcePrefix: policy,
      resourceTracks: [{ entityId: 1, time: 0, stack: entity.resourceStack }],
    }),
  ).toThrow("Choose an explicit");
});

test("both resource references invalidate at the original request entry while placement references remain distinct", async () => {
  const r = report([request()]),
    { policy } = await setup(r);
  const world = createLatestWorldPresentation({
    report: r,
    scene: {
      build,
      protocol,
      map: { min: [0, 0, 0], max: [10, 1, 10], movementOrigin: [5, 5] },
    },
    terrain: { sampleHeight: () => ({ inside: true, height: 0 }) },
    initialResourcePrefix: policy,
  });
  const descriptor = {
    field8c: 0,
    resourceContextEntityId: 1,
    lookupA8EntityId: 1,
    lookup14EntityId: 2,
    attachmentEntityId: 3,
    resourceKey: 1,
    unresolvedAuxiliaryContextIds: [],
  };
  const select = (entryOrder, exclusive = false) =>
    selectLatestWorldEffectResource({
      descriptor,
      time: 2,
      cursor: { transportSequence: 20, entryOrder, exclusive },
      world,
      unitResources: {
        metadata: { build, protocol },
        selectSuppliedStacks: ({ units }) => ({
          status: units.every(
            (unit) => unit.status === "supplied-resource-stack",
          )
            ? "continue-global-resolution"
            : "unresolved-unit-resource-stack",
          unitIndex: 0,
        }),
      },
    });
  const before = select(0, true);
  expect(before.status).toBe("continue-global-resolution");
  expect(
    before.presentation.units.map((unit) => [
      unit.unitIndex,
      unit.field,
      unit.sourceEventId,
    ]),
  ).toEqual([
    [0, "resourceContextEntityId", "hero-creation:1:10:0"],
    [1, "lookupA8EntityId", "hero-creation:1:10:0"],
  ]);
  for (const selected of [select(0), select(1)]) {
    expect(selected.status).toBe("unresolved-unit-resource-stack");
    expect(
      selected.presentation.units.map((unit) => unit.blockingRequest.id),
    ).toEqual(["resource-request:20:0", "resource-request:20:0"]);
    expect(selected.presentation.nativeAcceptance).toBeNull();
  }
  expect(
    world
      .references(descriptor, 2)
      .map(({ field, entityId, status }) => ({ field, entityId, status })),
  ).toEqual([
    { field: "resourceContextEntityId", entityId: 1, status: "registered" },
    { field: "lookup14EntityId", entityId: 2, status: "unresolved" },
    { field: "attachmentEntityId", entityId: 3, status: "unresolved" },
    { field: "lookupA8EntityId", entityId: 1, status: "registered" },
  ]);
  expect(select(0, true)).toEqual(before);
});
