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
  const runAt = "2026-11-12T08:00:00Z";
  const successAt = "2026-11-12T08:01:00Z";
  await updatePromotionState(store, "pmc", (state) => ({
    ...state,
    attempts: [
      {
        occurrenceId,
        attemptedAt: runAt,
        settledAt: successAt,
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
      startedAt: runAt,
      finishedAt: new Date().toISOString(),
    },
  });
  await finishPromotionBatch({ store, id: "sweep", overlaps: [] });
  put.mockClear();
  const now = Date.parse("2026-11-14T09:00:00Z");
  const view = await readProductionPromotionStatus(store, {
    now,
    readPlanning: () =>
      Promise.resolve({
        available: true,
        enabled: true,
        enabledTargets: ["pmc"],
        schedule: { status: "active", times: ["2026-11-15T00:00:00Z"] },
      }),
  });
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
  const timing = {
    lastRunAt: runAt,
    lastSuccessAt: successAt,
    nextPlannedAt: "2026-11-15T00:00:00.000Z",
    nextPlannedReason: "Expected scheduled opportunity",
  };
  expect(
    view.overview.sources.find((source) => source.id === "pmc")?.timing,
  ).toEqual(timing);
  expect(
    view.overview.lastRun.rows.find((row) => row.targetId === "pmc")?.timing,
  ).toEqual(timing);
  // Read at 01:00 Pacific on Nov 14; the post was confirmed just after midnight on Nov 12.
  const activity = view.overview.sources.find(
    (source) => source.id === "pmc",
  )?.activity;
  expect(activity?.startDay).toBe("2026-10-16");
  expect(activity?.days).toHaveLength(30);
  expect(activity?.days.at(-3)).toEqual({ posts: 1, failures: 0, noAction: 0 });
  expect(
    activity?.days.filter((day) => day.posts + day.failures + day.noAction > 0),
  ).toHaveLength(1);
  expect(
    view.overview.sources.find((source) => source.id === "reddit-mcservers")
      ?.activity?.days,
  ).toHaveLength(30);
  const unavailable = await readProductionPromotionStatus(store, {
    now,
    readPlanning: () =>
      Promise.resolve({
        available: true,
        enabled: true,
        enabledTargets: ["pmc"],
        schedule: { status: "unavailable" },
      }),
  });
  expect(
    unavailable.overview.sources.find((source) => source.id === "pmc")?.timing,
  ).toEqual({
    ...timing,
    nextPlannedAt: null,
    nextPlannedReason: "Schedule unavailable",
  });
  expect(put).not.toHaveBeenCalled();
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
