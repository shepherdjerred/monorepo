import { describe, expect, test } from "vitest";
import { buildPrState } from "@shepherdjerred/pr-fleet-controller/src/fleet-logic.ts";
import { busyStackIds } from "@shepherdjerred/pr-fleet-controller/src/controller-dispatch.ts";
import { FleetStore } from "@shepherdjerred/pr-fleet-controller/src/state.ts";
import { evidence, identity } from "./fixtures.ts";

function state(number: number, stackId = `pr-${String(number)}`) {
  const pr = identity(number);
  return buildPrState(
    { identity: pr, evidence: evidence(pr), stackId },
    {
      previous: undefined,
      pausedReason: undefined,
      model: "openai/gpt-5",
    },
  ).state;
}

describe("controller leases", () => {
  test("serializes setup and same-stack writes", () => {
    const store = new FleetStore(2);
    const first = state(1, "stack");
    const second = state(2, "stack");
    expect(store.requestLease(first, "setup")).toBe(true);
    expect(store.requestLease(second, "setup")).toBe(false);
    expect(store.requestLease(first, "stack-write")).toBe(true);
    expect(store.requestLease(second, "stack-write")).toBe(false);
    store.releaseLeases(first.identity.number);
    expect(store.requestLease(second, "setup")).toBe(true);
    expect(store.requestLease(second, "stack-write")).toBe(true);
  });

  test("caps heavy work at the selected worker limit", () => {
    const store = new FleetStore(1);
    expect(store.requestLease(state(1), "heavy")).toBe(true);
    expect(store.requestLease(state(2), "heavy")).toBe(false);
  });

  test("reports a bounded reason when a lease is unavailable", () => {
    const store = new FleetStore(1);
    expect(store.requestLeaseDecision(state(1), "setup")).toEqual({
      granted: true,
    });
    expect(store.requestLeaseDecision(state(2), "setup")).toEqual({
      granted: false,
      reason: "setup-held",
    });
  });

  test("returns the tracked duration when releasing an acquired lease", () => {
    const store = new FleetStore(1);
    const pr = state(1);
    expect(store.requestLease(pr, "heavy")).toBe(true);
    expect(store.releaseLease(pr.identity.number, "heavy", pr.stackId)).toEqual(
      expect.any(Number),
    );
  });

  test("reserves a stack while one PR waits for operator input", () => {
    const store = new FleetStore(2);
    const waiting = state(1, "shared-stack");
    store.prs.set(waiting.identity.number, {
      ...waiting,
      status: "waiting-for-answer",
      classification: "waiting-for-answer",
    });
    expect(busyStackIds(store)).toEqual(new Set(["shared-stack"]));
  });
});
