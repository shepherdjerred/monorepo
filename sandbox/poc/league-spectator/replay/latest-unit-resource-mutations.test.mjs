import { expect, test } from "bun:test";
import {
  LatestUnitResourceMutations,
  UNIT_RESOURCE_MUTATIONS_SHA,
} from "./latest-unit-resource-mutations.mjs";
import { createLatestWorldPresentation } from "./latest-world-presentation.mjs";

const contract = {
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  decoderImageSha256: "0".repeat(64),
  programSha256: UNIT_RESOURCE_MUTATIONS_SHA,
};
const kernel = () => new LatestUnitResourceMutations(contract);
const a = { id: "resolver:A", contextIdentity: 100 };
const b = { id: "resolver:B", contextIdentity: 100 };
const proof = {
  kind: "explicit-control",
  producerId: "test:typed-control",
  evidenceSha256: "1".repeat(64),
};
const clock = (sequence, overrides = {}) => ({
  id: `event:${sequence}`,
  sourceEventId: `packet:${sequence}`,
  entityId: 1,
  time: 1,
  transportSequence: sequence,
  entryOrder: 0,
  verification: proof,
  acceptedByLiveUnit: false,
  ...overrides,
});
const initial = (overrides = {}) => ({
  ...clock(1),
  status: "verified-unit-resource-initial-state",
  context: null,
  base: a,
  overlays: [],
  ...overrides,
});
const mutation = (sequence, kind, values = {}) => ({
  ...clock(sequence),
  status: "verified-unit-resource-mutation",
  kind,
  ...values,
});

test("same-context-label resolver handles remain distinct and pushes move only the matching identity", () => {
  const k = kernel();
  let state = k.initialize(initial({ overlays: [a, b, null] }));
  state = k.apply(state, mutation(2, "push-overlay", { resolver: a }));
  expect(state.stack.overlays.map((handle) => handle?.id ?? null)).toEqual([
    b.id,
    null,
    a.id,
  ]);
  expect(state.identityBindings).toEqual([a, b]);
  state = k.apply(state, mutation(3, "remove-overlay", { resolver: b }));
  expect(state.stack.overlays).toEqual([null, a]);
});

test("context assignment preserves overlays, null context retains base and typed null resolver clears it", () => {
  const k = kernel(),
    baseline = k.initialize(initial({ overlays: [b, null] }));
  const assigned = k.apply(
    baseline,
    mutation(2, "assign-context", {
      context: { id: "context:B", resolver: b },
    }),
  );
  expect(assigned.stack).toEqual({
    status: "supplied-resource-stack",
    base: b,
    overlays: [b, null],
  });
  const clearedContext = k.apply(
    assigned,
    mutation(3, "assign-context", { context: null }),
  );
  expect(clearedContext.context).toBeNull();
  expect(clearedContext.stack.base).toEqual(b);
  const clearedBase = k.apply(
    clearedContext,
    mutation(4, "assign-context", {
      context: { id: "context:empty", resolver: null },
    }),
  );
  expect(clearedBase.stack.base).toBeNull();
  expect(clearedBase.stack.overlays).toEqual([b, null]);
  expect(baseline.stack.base).toEqual(a);
});

test("first-only removal includes duplicate and null identities from explicit initial state", () => {
  const k = kernel();
  let state = k.initialize(initial({ overlays: [a, a, null, null] }));
  state = k.apply(state, mutation(2, "remove-overlay", { resolver: a }));
  expect(state.stack.overlays).toEqual([a, null, null]);
  state = k.apply(state, mutation(3, "push-overlay", { resolver: null }));
  expect(state.stack.overlays).toEqual([a, null, null]);
  state = k.apply(state, mutation(4, "remove-overlay", { resolver: null }));
  expect(state.stack.overlays).toEqual([a, null]);
});

test("overlay growth rejects capacity overflow before returning an uncheckpointable state", () => {
  const k = kernel();
  const state = k.initialize(initial({ overlays: Array(4096).fill(a) }));
  for (const resolver of [b, null])
    expect(() =>
      k.apply(state, mutation(2, "push-overlay", { resolver })),
    ).toThrow("Resource overlay vector exceeds its bound");
  expect(state.stack.overlays).toHaveLength(4096);
  expect(k.restore(k.checkpoint(state)).stack.overlays).toHaveLength(4096);
  const removed = k.apply(
    state,
    mutation(2, "remove-overlay", { resolver: a }),
  );
  const filled = k.apply(
    removed,
    mutation(3, "push-overlay", { resolver: null }),
  );
  expect(filled.stack.overlays).toHaveLength(4096);
  expect(filled.stack.overlays.at(-1)).toBeNull();
  expect(k.restore(k.checkpoint(filled)).stack.overlays).toEqual(
    filled.stack.overlays,
  );
});

test("checkpoints restore identity bindings and reject incompatible or corrupt contracts", () => {
  const k = kernel();
  const state = k.apply(
    k.initialize(initial()),
    mutation(2, "push-overlay", { resolver: b }),
  );
  const checkpoint = JSON.parse(JSON.stringify(k.checkpoint(state)));
  const restored = k.restore(checkpoint);
  checkpoint.state.stack.overlays.length = 0;
  expect(restored.stack.overlays).toEqual([b]);
  expect(
    k.apply(restored, mutation(3, "remove-overlay", { resolver: b })).stack
      .overlays,
  ).toEqual([]);
  expect(() =>
    k.restore({ ...checkpoint, contract: { ...contract, build: "other" } }),
  ).toThrow("Incompatible");
  const malformed = JSON.parse(JSON.stringify(k.checkpoint(state)));
  malformed.state.identityBindings[1].contextIdentity = 200;
  expect(() => k.restore(malformed)).toThrow("identity changed");
});

test("causal resource tracks fit world queries and backward seeks without claiming raw requests", () => {
  const k = kernel(),
    init = initial();
  const track = k.createTrack({
    initialStates: [init],
    mutations: [
      mutation(3, "push-overlay", { resolver: b }),
      mutation(2, "push-overlay", { resolver: a }),
    ],
  });
  expect(track.state(1, 0.5)).toBeNull();
  expect(
    track.state(1, 1, { transportSequence: 3, entryOrder: 0, exclusive: true })
      .stack.overlays,
  ).toEqual([a]);
  expect(track.state(1, 1).stack.overlays).toEqual([a, b]);
  expect(
    track.state(1, 1, { transportSequence: 1, entryOrder: 0 }).stack.overlays,
  ).toEqual([]);
  const world = createLatestWorldPresentation({
    report: {
      build: contract.build,
      protocol: contract.protocol,
      heroes: [],
      movement: [],
      lifecycle: [],
      worldEvents: [
        {
          kind: "npc-creation-candidate",
          entityId: 1,
          character: "Control",
          skinId: 0,
          skinStatus: "explicit-control",
          creationPosition: [0, 0, 0],
          time: 0,
          transportSequence: 0,
          entryOrder: 0,
        },
      ],
    },
    scene: {
      build: contract.build,
      protocol: contract.protocol,
      map: { min: [0, 0, 0], max: [10, 1, 10], movementOrigin: [5, 5] },
    },
    terrain: { sampleHeight: () => ({ inside: true, height: 0 }) },
    resourceTracks: track.resourceTracks,
  });
  expect(world.entity(1, 1).resourceStack).toEqual(track.state(1, 1).stack);
  expect(
    world.entity(1, 1, { transportSequence: 3, entryOrder: 0, exclusive: true })
      .resourceStack.overlays,
  ).toEqual([a]);
  expect(world.entity(1, 0.5).resourceStack).toBeNull();
  expect(() =>
    k.apply(track.state(1, 1), {
      ...mutation(4, "push-overlay", { resolver: b }),
      status: "appearance-stack-request",
      acceptedByLiveUnit: null,
    }),
  ).toThrow("verified mutation");
});

test("raw initialization, causal duplicates and changing a retired handle's context are rejected", () => {
  const k = kernel(),
    state = k.initialize(initial({ overlays: [b] }));
  expect(() =>
    k.initialize({ ...initial(), status: "appearance-stack-request" }),
  ).toThrow("verified initial");
  expect(() =>
    k.apply(state, mutation(1, "remove-overlay", { resolver: b })),
  ).toThrow("causal order");
  const removed = k.apply(
    state,
    mutation(2, "remove-overlay", { resolver: b }),
  );
  expect(() =>
    k.apply(
      removed,
      mutation(3, "push-overlay", { resolver: { ...b, contextIdentity: 999 } }),
    ),
  ).toThrow("identity changed");
  expect(() =>
    k.createTrack({
      initialStates: [initial()],
      mutations: [
        mutation(2, "push-overlay", { resolver: b }),
        mutation(2, "remove-overlay", { resolver: b }),
      ],
    }),
  ).toThrow("Duplicate");
  expect(() =>
    k.initialize({
      ...initial(),
      verification: { ...proof, kind: "verified-producer" },
      acceptedByLiveUnit: null,
    }),
  ).toThrow("provenance");
});
