import { expect, test } from "bun:test";
import { createDirectEventReasonOwnership } from "./latest-direct-event-reasons.mjs";

test("working omission aliases survive cycles, Map keys and Set entries while original inputs stay pristine", () => {
  const reasons = ["original"],
    omitted = { id: "omitted", kind: "omitted", reasons },
    graph = { map: new Map([[reasons, new Set([reasons])]]) };
  graph.self = graph;
  const event = { id: "create", kind: "create", graph },
    owner = createDirectEventReasonOwnership([event, omitted]),
    created = owner.creation(event),
    working = owner.omitted(omitted);
  working.push("later");
  expect(created.graph.self).toBe(created.graph);
  expect([...created.graph.map.keys()][0]).toBe(working);
  expect([...created.graph.map.get(working)][0]).toBe(working);
  expect(reasons).toEqual(["original"]);
  const state = structuredClone({
    ledger: [[omitted.id, { reasons: working }]],
    reasonBindings: owner.checkpoint(new Map([["active", { event: created }]]))
      .bindings,
    instances: [["active", { event: created }]],
  });
  owner.restore(state);
  expect([...state.instances[0][1].event.graph.map.keys()][0]).toBe(
    state.ledger[0][1].reasons,
  );
  owner.restore({ ledger: [], reasonBindings: [], instances: [] });
  expect(owner.omitted(omitted)).toEqual(["original"]);
});

test("unequal aliased versions reject without replacing the current reason owner", () => {
  const reasons = ["original"],
    a = { id: "a", kind: "omitted", reasons },
    b = { id: "b", kind: "omitted", reasons },
    owner = createDirectEventReasonOwnership([a, b]),
    working = owner.omitted(a);
  expect(() =>
    owner.restore({
      ledger: [
        ["a", { reasons: ["original"] }],
        ["b", { reasons: ["different"] }],
      ],
      reasonBindings: [],
    }),
  ).toThrow("unequal versions");
  expect(owner.omitted(a)).toBe(working);
  expect(() =>
    owner.restore({ ledger: [], reasonBindings: [[99, []]] }),
  ).toThrow("identity/value");
});
