import { expect, it } from "vitest";
import {
  initialPromotionState,
  promotionFailurePause,
  promotionRunBlocked,
} from "#shared/promotion.ts";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
import {
  readPromotionState,
  updatePromotionState,
} from "#activities/promotion/store.ts";
import { recordPromotionExecutionHealth } from "#activities/promotion/control/execution-health.ts";
import { executeLocalPromotion } from "./local-execution.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";

it("allows retry after one failure, pauses after two, and ignores duplicate outcome delivery", async () => {
  const store = memoryPromotionStore();
  const record = (
    occurrenceId: string,
    outcome: "success" | "failure" | "skip",
    mode: "run" | "preview" | "reconcile" = "run",
  ) =>
    recordPromotionExecutionHealth({
      store,
      targetId: "pmc",
      occurrenceId,
      outcome,
      mode,
    });
  await record("one", "failure");
  expect(promotionRunBlocked(await readPromotionState(store, "pmc"))).toBe(
    false,
  );
  await record("one", "failure");
  await record("cooldown", "skip");
  await record("preview", "failure", "preview");
  await record("reconcile", "failure", "reconcile");
  const once = await readPromotionState(store, "pmc");
  expect(once.executionHealth.consecutiveFailures).toBe(1);
  await record("two", "failure");
  const paused = await readPromotionState(store, "pmc");
  expect(promotionFailurePause(paused)).toContain("2 consecutive failures");
  expect(promotionRunBlocked(paused)).toBe(true);
  await expect(
    executeLocalPromotion({
      store,
      target: promotionTarget("pmc"),
      mode: "run",
      execute: async () => {
        throw new Error("Should not execute");
      },
    }),
  ).rejects.toThrow("2 consecutive failures");
});

it("resets the consecutive streak on success and retains explicit pauses", async () => {
  const store = memoryPromotionStore();
  for (const [occurrenceId, outcome] of [
    ["one", "failure"],
    ["two", "success"],
    ["three", "failure"],
  ] as const)
    await recordPromotionExecutionHealth({
      store,
      targetId: "pmc",
      mode: "run",
      occurrenceId,
      outcome,
    });
  const once = await readPromotionState(store, "pmc");
  expect(once.executionHealth.consecutiveFailures).toBe(1);
  await updatePromotionState(store, "pmc", (s) => ({ ...s, paused: true }));
  await recordPromotionExecutionHealth({
    store,
    targetId: "pmc",
    mode: "reconcile",
    occurrenceId: "confirmed",
    outcome: "success",
  });
  const state = await readPromotionState(store, "pmc");
  expect(state.executionHealth.consecutiveFailures).toBe(0);
  expect(promotionRunBlocked(state)).toBe(true);
});

it("accepts a successful retry within the same occurrence without recounting its failed delivery", async () => {
  const store = memoryPromotionStore();
  const input = {
    store,
    targetId: "pmc",
    mode: "run" as const,
    occurrenceId: "same",
  };
  await recordPromotionExecutionHealth({ ...input, outcome: "failure" });
  await recordPromotionExecutionHealth({ ...input, outcome: "success" });
  await recordPromotionExecutionHealth({ ...input, outcome: "failure" });
  const state = await readPromotionState(store, "pmc");
  expect(state.executionHealth.consecutiveFailures).toBe(0);
});

it("retries an ordinary diagnostic but preserves ambiguous publication protection", async () => {
  const store = memoryPromotionStore();
  await updatePromotionState(store, "pmc", (s) => ({
    ...s,
    blockedReason: "Transient transport error",
  }));
  let calls = 0;
  await executeLocalPromotion({
    store,
    target: promotionTarget("pmc"),
    mode: "run",
    execute: async () => {
      calls++;
    },
  });
  expect(calls).toBe(1);
  const state = initialPromotionState("pmc", 900);
  state.attempts.push({
    occurrenceId: "uncertain",
    attemptedAt: new Date().toISOString(),
    settledAt: null,
    status: "uncertain",
    receiptUrl: null,
    evidenceKey: null,
    contentHash: "fixture",
    beforeSubmission: [],
  });
  expect(promotionRunBlocked(state)).toBe(true);
});
