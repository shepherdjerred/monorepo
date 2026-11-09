import { expect, it } from "vitest";
import { localOwnerAlive } from "./process-owner.ts";
import { promotionWindow } from "#shared/promotion/cadence.ts";
import { initialPromotionState } from "#shared/promotion.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";
import { approvedDiscordCopy } from "#activities/promotion/publication/approved-copy.ts";
import {
  reservePromotionAi,
  dailyPromotionSolverCharges,
} from "#activities/promotion/control/budget.ts";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";

it("distinguishes a reused PID from the executor which acquired a claim", () => {
  expect(localOwnerAlive(process.pid, new Date().toISOString())).toBe(true);
  expect(localOwnerAlive(process.pid, "2000-01-01T00:00:00Z")).toBe(false);
  expect(() => localOwnerAlive(process.pid, "invalid")).toThrow("claim time");
  expect(() => localOwnerAlive(0)).toThrow("PID");
});
it("limits daily sources to the evening and preserves their cooldown", () => {
  const state = initialPromotionState("pmc", 900),
    target = promotionTarget("pmc");
  expect(
    promotionWindow(target, state, Date.parse("2026-11-09T12:00:00-08:00"))
      .allowed,
  ).toBe(false);
  state.nextEligibleAt = "2026-11-09T17:30:00-08:00";
  expect(
    promotionWindow(target, state, Date.parse("2026-11-09T16:00:00-08:00")),
  ).toMatchObject({
    allowed: true,
    canDispatch: true,
    dueAt: Date.parse(state.nextEligibleAt),
  });
  state.nextEligibleAt = "2026-11-09T21:00:00-08:00";
  expect(
    promotionWindow(target, state, Date.parse("2026-11-09T16:00:00-08:00"))
      .canDispatch,
  ).toBe(false);
  expect(
    promotionWindow(target, state, Date.parse("2026-11-09T20:00:00-08:00"))
      .allowed,
  ).toBe(false);
});
it("uses Pacific evening hours across daylight saving transitions", () => {
  const target = promotionTarget("pmc"),
    state = initialPromotionState("pmc", 900);
  for (const at of ["2026-03-08T16:00:00-07:00", "2026-11-01T16:00:00-08:00"])
    expect(promotionWindow(target, state, Date.parse(at)).allowed).toBe(true);
});
it("caps a fast source at four attempted publications per Pacific day", () => {
  const target = promotionTarget("disboard-native-bump");
  const state = initialPromotionState(target.id, 900);
  state.attempts = Array.from({ length: 4 }, (_, index) => ({
    occurrenceId: `fixture-${String(index)}`,
    attemptedAt: "2026-11-09T16:00:00Z",
    settledAt: "2026-11-09T16:00:00Z",
    status: "rejected" as const,
    receiptUrl: null,
    evidenceKey: null,
    contentHash: "fixture",
    beforeSubmission: [],
  }));
  expect(
    promotionWindow(target, state, Date.parse("2026-11-09T19:00:00-08:00"))
      .allowed,
  ).toBe(false);
  expect(
    promotionWindow(target, state, Date.parse("2026-11-10T08:00:00-08:00"))
      .allowed,
  ).toBe(true);
});
it("includes charges from both UTC months in a Pacific spending day", async () => {
  const store = memoryPromotionStore();
  for (const [month, createdAt] of [
    ["2026-10", "2026-10-31T23:59:00Z"],
    ["2026-11", "2026-11-01T00:01:00Z"],
  ] as const) {
    await store.put(
      `solver/${month}.json`,
      {
        version: 1,
        charges: {
          fixture: {
            createdAt,
            occurrenceId: "fixture",
            taskId: 1,
            reservedMicrousd: 1000,
            chargedMicrousd: 1000,
          },
        },
      },
      undefined,
    );
  }
  const charges = await dailyPromotionSolverCharges(
    store,
    new Date("2026-11-01T01:00:00Z"),
  );
  expect(charges).toHaveLength(2);
});
it("stops new paid work when previous usage is unknown", async () => {
  const store = memoryPromotionStore();
  await reservePromotionAi(store, "one", {
    model: "gpt-5.6-luna",
    dailySpendUsd: 5,
  });
  await expect(
    reservePromotionAi(store, "two", {
      model: "gpt-5.6-luna",
      dailySpendUsd: 5,
    }),
  ).rejects.toThrow("unknown");
});
it("loads full and short approved variants without shell processing", async () => {
  const variants = await approvedDiscordCopy();
  expect(variants).toHaveLength(5);
  const wire = JSON.stringify(variants);
  expect(JSON.parse(wire)).toEqual(variants);
  expect(variants[0]).toContain("we're");
});
