import { expect, it } from "vitest";
import type { PromotionBatch, PromotionHistoryEntry } from "./model.ts";
import { PromotionSourceTimingSchema } from "./model.ts";
import { promotionHistoryTiming } from "./timing.ts";

const batch = (
  id: string,
  mode: PromotionBatch["mode"],
  changes: Partial<PromotionBatch["entries"][number]> = {},
): PromotionBatch => ({
  version: 1,
  id,
  pid: 1,
  mode,
  startedAt: "2026-11-14T08:00:00Z",
  updatedAt: "2026-11-14T08:01:00Z",
  finishedAt: "2026-11-14T08:01:00Z",
  entries: [
    {
      targetId: "pmc",
      status: "completed",
      phase: "verified",
      startedAt: "2026-11-14T08:00:00Z",
      finishedAt: "2026-11-14T08:01:00Z",
      occurrenceId: id,
      summary: "Fixture",
      ...changes,
    },
  ],
});

const history = (
  changes: Partial<PromotionHistoryEntry> = {},
): PromotionHistoryEntry => ({
  id: "success",
  batchId: null,
  targetId: "pmc",
  mode: "unknown",
  status: "verified",
  summary: "Verified publishing attempt",
  at: "2026-11-12T08:00:00Z",
  timeBasis: "attempt",
  finishedAt: "2026-11-12T08:01:00Z",
  occurrenceId: "success",
  receiptUrl: "https://example.com/",
  evidenceId: null,
  costUsd: null,
  cleanup: null,
  ...changes,
});

it("keeps last publishing execution and success independent of later previews, skips and failures", () => {
  const timing = promotionHistoryTiming({
    targetId: "pmc",
    batches: [
      batch("failure", "run", {
        status: "failed",
        phase: "blocked",
        startedAt: "2026-11-13T08:00:00Z",
      }),
      batch("preview", "preview"),
      batch("cleanup", "cleanup"),
      batch("reconcile", "reconcile"),
      batch("skipped", "run", { status: "skipped", startedAt: null }),
      batch("queued", "run", { status: "queued", startedAt: null }),
      batch("effective-reconcile", "run", { effectiveMode: "reconcile" }),
    ],
    history: [
      history(),
      history({
        id: "newer-failure",
        status: "rejected",
        at: "2026-11-13T08:00:00Z",
        finishedAt: "2026-11-13T08:01:00Z",
      }),
      history({
        id: "legacy",
        timeBasis: "report-saved",
        mode: "run",
        at: "2026-11-14T08:00:00Z",
        finishedAt: "2026-11-14T08:01:00Z",
      }),
      history({
        id: "preview",
        mode: "preview",
        timeBasis: "execution",
        at: "2026-11-14T08:00:00Z",
        finishedAt: "2026-11-14T08:01:00Z",
      }),
    ],
  });
  expect(timing).toEqual({
    lastRunAt: "2026-11-13T08:00:00Z",
    lastSuccessAt: "2026-11-12T08:01:00Z",
  });
});

it("uses the latest confirmed completion rather than input ordering and keeps missing times explicit", () => {
  expect(
    promotionHistoryTiming({
      targetId: "absent",
      batches: [],
      history: [history()],
    }),
  ).toEqual({ lastRunAt: null, lastSuccessAt: null });
  expect(
    promotionHistoryTiming({
      targetId: "pmc",
      batches: [],
      history: [
        history(),
        history({
          at: "2026-11-11T08:00:00Z",
          finishedAt: "2026-11-13T08:00:00Z",
        }),
      ],
    }).lastSuccessAt,
  ).toBe("2026-11-13T08:00:00Z");
  expect(
    PromotionSourceTimingSchema.parse({
      lastRunAt: null,
      lastSuccessAt: null,
      nextPlannedAt: null,
      nextPlannedReason: "Manual runs only",
    }).nextPlannedAt,
  ).toBeNull();
});

it("counts a started execution that discovers a cooldown while ignoring unstarted inventory skips", () => {
  const timing = promotionHistoryTiming({
    targetId: "pmc",
    batches: [
      batch("deferred", "run", { status: "skipped", phase: "cooldown" }),
      batch("inventory", "run", { status: "skipped", startedAt: null }),
    ],
    history: [],
  });
  expect(timing.lastRunAt).toBe("2026-11-14T08:00:00Z");
});
