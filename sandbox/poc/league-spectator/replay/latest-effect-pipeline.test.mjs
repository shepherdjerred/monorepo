import { expect, test } from "bun:test";
import { createLatestRequestTimeline } from "./latest-effect-pipeline.mjs";

test("full-match sparse checkpoints preserve exact forward and backward ordered state", () => {
  const events = [],
    templates = new Map();
  for (let index = 0; index < 12000; index++) {
    const entityId = (index % 997) + 1,
      sequence = index * 2;
    templates.set(index, { entityId, creationSequence: index });
    events.push({
      kind: "create-request",
      entityId,
      time: sequence / 60,
      transportSequence: sequence,
      creationSequence: index,
    });
    events.push({
      kind: "remove-request",
      entityId,
      time: (sequence + 1) / 60,
      transportSequence: sequence + 1,
      removalSequence: index,
      requestedFlagMask: 0x800,
    });
  }
  const timeline = createLatestRequestTimeline(
    events,
    templates,
    {},
    400,
    (index) => ({ originalSequence: index }),
  );
  expect(timeline.checkpointCount).toBeLessThanOrEqual(17);
  for (const time of [399.99, 0, 77.125, 350, 12.25, 399.99, 120.5]) {
    const expected = new Map();
    for (const event of events) {
      if (event.time > time) break;
      const prior = expected.get(event.entityId);
      if (event.kind === "create-request")
        expected.set(event.entityId, {
          entityId: event.entityId,
          generation: (prior?.generation ?? 0) + 1,
          creationSequence: event.creationSequence,
          phase: "creation-requested",
          requestedFlags: 0,
          removalCount: 0,
          lastRemovalSequence: null,
        });
      else
        expected.set(event.entityId, {
          ...prior,
          phase: "removal-requested",
          requestedFlags: prior.requestedFlags | event.requestedFlagMask,
          removalCount: prior.removalCount + 1,
          lastRemovalSequence: event.removalSequence,
        });
    }
    expect(timeline.snapshot(time).entities).toEqual(
      [...expected.values()].sort(
        (left, right) => left.entityId - right.entityId,
      ),
    );
  }
  expect(timeline.creation(11000).descriptor).toEqual({
    originalSequence: 11000,
  });
});
