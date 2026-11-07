import { expect, test } from "bun:test";
import { createTriggerOnHitNoHitActors } from "./latest-trigger-on-hit.mjs";
import { createPresentationMissileActors } from "./latest-presentation-missile-actors.mjs";
import { createLatestMissileActors } from "./latest-missile-actors.mjs";
const definition = await Bun.file(
  new URL(
    "../../../../.cache/replay-spike/public/decoder-16.21-macos/missile-actors.json",
    import.meta.url,
  ),
).json();
const actors = createTriggerOnHitNoHitActors(
  createPresentationMissileActors(createLatestMissileActors(definition)),
);
test("only the original source-shaped TriggerOnHit action list is admitted to no-hit local operations", () => {
  expect(
    actors.settings([
      { __type: "TriggerOnHit", mActions: [{ __type: "Cast" }] },
    ]).reasons,
  ).toEqual([]);
  for (const spec of [
    { __type: "TriggerOnHit" },
    { __type: "TriggerOnHit", mActions: [] },
    { __type: "TriggerOnHit", mActions: [{ __type: "Cast", unknown: 1 }] },
    { __type: "TriggerOnHit", mActions: [{ __type: "Destroy" }] },
    { __type: "TriggerOnHit", mActions: [{ __type: "Cast" }], unknown: 1 },
  ])
    expect(actors.settings([spec]).reasons.length).toBeGreaterThan(0);
});
test("no-hit component order preserves completion request identity and explicitly rejects hit actions", () => {
  const record = {
    entityId: 1,
    cast: { targetCount: 0 },
    pendingChildren: 0,
    replicationPhase: 0,
    behaviorSpecs: [
      { __type: "TriggerOnHit", mActions: [{ __type: "Cast" }] },
      { __type: "CastOnMovementComplete" },
      { __type: "DestroyOnMovementComplete" },
    ],
  };
  const state = actors.initialize(record, [1, 2, 3], {
    instanceId: "instance:1",
    sourceEventId: "packet:1",
  });
  expect(state.components.map((c) => c.type)).toEqual(
    record.behaviorSpecs.map((c) => c.__type),
  );
  actors.afterMovement(state, true, 1);
  expect(state.castRequests).toHaveLength(1);
  expect(state.castRequests[0].componentIndex).toBe(1);
  expect(state.components[0].actions[0].executed).toBe(false);
  const before = structuredClone(state);
  expect(() => actors.hit(state)).toThrow("remain untranslated");
  expect(state).toEqual(before);
});
