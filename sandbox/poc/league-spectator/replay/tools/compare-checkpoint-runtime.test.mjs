import { expect, test } from "bun:test";
import { compareCheckpointRuntime } from "./compare-checkpoint-runtime.mjs";
import {
  DIRECT_EFFECT_BUILD,
  DIRECT_EFFECT_PROTOCOL,
} from "../latest-direct-effect-runtime.mjs";

test("current simulation and exact original cache agree across long repeated seeks", async () => {
  const events = Array.from({ length: 301 }, (_, index) => ({
    id: `unresolved:${index}`,
    kind: "omitted",
    origin: "network-effect",
    entityId: index + 1,
    time: index * 10,
    transportSequence: index,
    entryOrder: 0,
    reasons: ["test-only unresolved event"],
  }));
  const before = structuredClone(events),
    unexpected = () => {
      throw Error("Unresolved-event control invoked particles");
    };
  const result = await compareCheckpointRuntime({
    runtimeInputs: {
      build: DIRECT_EFFECT_BUILD,
      protocol: DIRECT_EFFECT_PROTOCOL,
      contentHash: "a".repeat(64),
      replayHash: "b".repeat(64),
      definitions: new Map(),
      events,
      world: { placement: unexpected },
      kernels: {
        birth: { createRandom: unexpected },
        emission: { count: unexpected },
      },
    },
    times: [0, 3022.7, 1500, 60, 2900, 0, 3022.7],
    camera: { right: [1, 0, 0], up: [0, 1, 0] },
  });
  expect(result.comparisons).toHaveLength(7);
  expect(result.comparisons.every((row) => row.matched)).toBe(true);
  expect(result.comparisons[1].comparedRows.ledger).toBe(301);
  expect(result.comparisons[2].candidateSteps).toBeLessThan(
    result.comparisons[2].baselineSteps,
  );
  expect(result.comparisons[4].candidateSteps).toBeLessThan(
    result.comparisons[4].baselineSteps,
  );
  expect(result.sourceDrift).toEqual([]);
  expect(events).toEqual(before);
  expect(Object.isFrozen(events[0])).toBe(false);
});
