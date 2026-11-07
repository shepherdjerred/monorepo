import { expect, test } from "bun:test";
import { createLatestMissileActors } from "./latest-missile-actors.mjs";
import {
  createPresentationMissileActors,
  normalizeCompletionCastDirection,
} from "./latest-presentation-missile-actors.mjs";

const definition = await Bun.file(
  new URL(
    "../../../../.cache/replay-spike/public/decoder-16.21-macos/missile-actors.json",
    import.meta.url,
  ),
).json();
const actors = createPresentationMissileActors(
  createLatestMissileActors(definition),
);
const record = (types = ["CastOnMovementComplete"]) => ({
  entityId: 71,
  pendingChildren: 0,
  replicationPhase: 0,
  behaviorSpecs: types.map((__type) => ({ __type })),
  cast: { sourceEntityId: 42 },
});
const source = {
  instanceId: "missile:71:generation:2",
  sourceEventId: "packet:30:entry:1",
};

test("completion actions retain ordered direction, origin and repeated-action generations", () => {
  const state = actors.initialize(record(), [1.25, -3.5, 7.75], source);
  actors.afterMovement(state, true, 6);
  actors.afterMovement(state, true, 6);
  expect(state.castRequests).toHaveLength(1);
  actors.afterMovement(state, false, 6);
  actors.afterMovement(state, true, 6);
  expect(state.castRequests).toHaveLength(2);
  expect(state.castRequests.map((request) => request.actionGeneration)).toEqual(
    [1, 2],
  );
  expect(new Set(state.castRequests.map((request) => request.id)).size).toBe(2);
  expect(state.castRequests[0]).toMatchObject({
    sourceEventId: source.sourceEventId,
    sourceInstanceId: source.instanceId,
    missileEntityId: 71,
    sourceCastRequest: { sourceEntityId: 42 },
    time: 6,
    rendered: false,
    nativeWorldAcceptance: null,
  });
  expect(state.castRequests[0].omissions).toContain(
    "presentation:downstream-original-cast-and-child-spawn-unimplemented",
  );
});

test("authored cast/destroy ordering determines the emitted request direction", () => {
  const before = actors.initialize(
    record(["CastOnMovementComplete", "DestroyOnMovementComplete"]),
    [3, 0, 4],
    source,
  );
  const after = actors.initialize(
    record(["DestroyOnMovementComplete", "CastOnMovementComplete"]),
    [3, 0, 4],
    source,
  );
  actors.advancePhase(before, 4);
  actors.advancePhase(after, 4);
  expect(before.castRequests[0].normalizedDirection).toEqual([
    Math.fround(0.6),
    0,
    Math.fround(0.8),
  ]);
  expect(after.castRequests[0].normalizedDirection).toEqual([0, 0, 0]);
  expect(before.presentationStopCalls).toBe(1);
  expect(after.presentationStopCalls).toBe(1);
});

test("completion request admission rejects unsupported phase, children and authored fields", () => {
  expect(() =>
    actors.initialize({ ...record(), replicationPhase: 1 }, [0, 0, 0], source),
  ).toThrow("initial-phase");
  expect(() =>
    actors.initialize({ ...record(), pendingChildren: 1 }, [0, 0, 0], source),
  ).toThrow("children");
  expect(
    actors.settings([{ __type: "CastOnMovementComplete", unknown: false }])
      .reasons,
  ).toEqual(["properties:CastOnMovementComplete"]);
  expect(() =>
    actors.initialize(record(), [0, 0, 0], { ...source, sourceEventId: "" }),
  ).toThrow("source event");
  expect(() =>
    actors.advancePhase(actors.initialize(record(), [0, 0, 0], source), NaN),
  ).toThrow("clock");
  expect(() =>
    actors.phaseNotification(
      actors.initialize(record(), [0, 0, 0], source),
      256,
      1,
    ),
  ).toThrow("phase byte");
});

test("original normalization retains subthreshold vectors and rejects coerced inputs", () => {
  expect(normalizeCompletionCastDirection([1e-6, 0, 0])).toEqual([
    Math.fround(1e-6),
    0,
    0,
  ]);
  expect(normalizeCompletionCastDirection([0, 0, 0])).toEqual([0, 0, 0]);
  for (const value of [null, true, "1", Infinity, 1e100])
    expect(() => normalizeCompletionCastDirection([value, 0, 0])).toThrow(
      "float32",
    );
});
