import { expect, it, vi } from "vitest";
import { initialPromotionState } from "#shared/promotion/model.ts";
import { promotionManifest } from "./manifest.ts";
import { memoryPromotionStore } from "./test-support.ts";
import {
  beginPromotionBatch,
  updatePromotionBatch,
  finishPromotionBatch,
} from "./control/batches.ts";
import { readProductionPromotionStatus } from "./control/status.ts";
import {
  reserveReconciliation,
  resetReconciliation,
} from "./control/reconciliation.ts";
import { readPromotionState, updatePromotionState } from "./store.ts";

it("reads production progress and receipts without initializing or mutating state", async () => {
  const store = memoryPromotionStore();
  const put = vi.spyOn(store, "put");
  const initial = await readProductionPromotionStatus(store);
  expect(initial.overview.lastRun.status).toBe("not_run");
  expect(put).not.toHaveBeenCalled();
  const states = promotionManifest.targets.map((t) =>
    initialPromotionState(t.id, 900),
  );
  await beginPromotionBatch({
    store,
    id: "sweep",
    targets: promotionManifest.targets,
    states,
    selected: ["pmc"],
  });
  const occurrenceId = "storm-promotion/pmc/fixture";
  await updatePromotionState(store, "pmc", (state) => ({
    ...state,
    attempts: [
      {
        occurrenceId,
        attemptedAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
        status: "verified",
        receiptUrl: "https://www.planetminecraft.com/server/the-storm-3004178/",
        evidenceKey: null,
        contentHash: "fixture",
        beforeSubmission: [],
      },
    ],
  }));
  await updatePromotionBatch({
    store,
    id: "sweep",
    targetId: "pmc",
    change: {
      status: "completed",
      phase: "verified",
      summary: "Bumped and confirmed",
      occurrenceId,
      finishedAt: new Date().toISOString(),
    },
  });
  await finishPromotionBatch({ store, id: "sweep", overlaps: [] });
  put.mockClear();
  const view = await readProductionPromotionStatus(store);
  expect(put).not.toHaveBeenCalled();
  expect(view.overview.scheduling).toBe("scheduled");
  expect(
    view.overview.lastRun.rows.find((row) => row.targetId === "pmc"),
  ).toMatchObject({
    outcome: "done",
    health: "working",
    receiptUrl: "https://www.planetminecraft.com/server/the-storm-3004178/",
  });
  expect(view.overview.lastRun.counts.done).toBe(1);
});

it("bounds read-only reconciliation by original effect and batch without altering the effect", async () => {
  const store = memoryPromotionStore(),
    state = initialPromotionState("pmc", 900);
  state.attempts = [
    {
      occurrenceId: "original",
      attemptedAt: new Date().toISOString(),
      settledAt: null,
      status: "uncertain",
      receiptUrl: null,
      evidenceKey: null,
      contentHash: "fixture",
      beforeSubmission: [],
    },
  ];
  await updatePromotionState(store, "pmc", () => state);
  expect(await reserveReconciliation(store, state, "one")).toBe(true);
  expect(await reserveReconciliation(store, state, "one")).toBe(true);
  expect(await reserveReconciliation(store, state, "two")).toBe(true);
  expect(await reserveReconciliation(store, state, "three")).toBe(false);
  const before = await readPromotionState(store, "pmc");
  expect(before.attempts[0]?.status).toBe("uncertain");
  await resetReconciliation(store, state);
  expect(await reserveReconciliation(store, state, "four")).toBe(true);
  const after = await readPromotionState(store, "pmc");
  expect(after.attempts).toEqual(before.attempts);
});
