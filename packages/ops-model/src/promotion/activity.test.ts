import { expect, it } from "vitest";
import type { PromotionBatch, PromotionHistoryEntry } from "./model.ts";
import { PromotionSourceActivitySchema } from "./model.ts";
import { promotionDay, promotionSourceActivity } from "./activity.ts";
import { promotionHistoryTiming } from "./timing.ts";

// 2026-11-19 12:00 PST. The 30-day window is 2026-10-21 through 2026-11-19.
const now = Date.parse("2026-11-19T20:00:00Z");

const attempt = (
  changes: Partial<PromotionHistoryEntry> = {},
): PromotionHistoryEntry => ({
  id: `attempt:${changes.occurrenceId ?? "a"}`,
  batchId: null,
  targetId: "pmc",
  mode: "unknown",
  status: "verified",
  summary: "Recorded publishing attempt",
  at: "2026-11-18T20:00:00Z",
  timeBasis: "attempt",
  finishedAt: "2026-11-18T20:01:00Z",
  occurrenceId: "a",
  receiptUrl: null,
  evidenceId: null,
  costUsd: null,
  cleanup: null,
  ...changes,
});

const run = (changes: Partial<PromotionHistoryEntry> = {}) =>
  attempt({
    id: `batch:${changes.occurrenceId ?? "a"}`,
    batchId: "batch",
    mode: "run",
    timeBasis: "execution",
    ...changes,
  });

const batch = (startedAt: string): PromotionBatch => ({
  version: 1,
  id: startedAt,
  pid: 0,
  mode: "run",
  startedAt,
  updatedAt: startedAt,
  finishedAt: startedAt,
  entries: [],
});

function activity(history: PromotionHistoryEntry[], batches = [batch(day(0))]) {
  const result = promotionSourceActivity({
    targetId: "pmc",
    history,
    batches,
    now,
  });
  return {
    ...result,
    on: (date: string) =>
      result.days[
        (Date.parse(`${date}T00:00:00Z`) -
          Date.parse(`${result.startDay}T00:00:00Z`)) /
          86_400_000
      ],
  };
}

function day(offset: number) {
  return new Date(now - offset * 86_400_000).toISOString();
}

it("covers exactly thirty Pacific days ending on the day of the read", () => {
  const result = activity([]);
  expect(result.startDay).toBe("2026-10-21");
  expect(result.days).toHaveLength(30);
  expect(
    result.days.every((d) => d.posts + d.failures + d.noAction === 0),
  ).toBe(true);
  expect(() => PromotionSourceActivitySchema.parse(result)).not.toThrow();
});

it("counts each occurrence once and lets the recorded attempt decide it", () => {
  const result = activity([
    // Confirmed post, also listed by its run.
    attempt({ occurrenceId: "posted" }),
    run({ occurrenceId: "posted" }),
    // The run reported a failure; the attempt was later confirmed.
    attempt({
      occurrenceId: "recovered",
      at: "2026-11-17T20:00:00Z",
      finishedAt: "2026-11-17T20:05:00Z",
    }),
    run({
      occurrenceId: "recovered",
      status: "blocked",
      at: "2026-11-17T20:00:00Z",
    }),
    // Blocked run whose attempt is still unconfirmed: one failure, not two.
    attempt({
      occurrenceId: "unconfirmed",
      status: "uncertain",
      at: "2026-11-16T20:00:00Z",
      finishedAt: null,
    }),
    run({
      occurrenceId: "unconfirmed",
      status: "blocked",
      at: "2026-11-16T20:00:00Z",
    }),
    // A failed run that never recorded an attempt.
    run({
      occurrenceId: "crashed",
      status: "failed",
      at: "2026-11-15T20:00:00Z",
    }),
    // An operator settled this attempt as never published.
    attempt({
      occurrenceId: "absent",
      status: "no-action",
      at: "2026-11-14T20:00:00Z",
    }),
  ]);
  expect(result.on("2026-11-18")).toEqual({
    posts: 1,
    failures: 0,
    noAction: 0,
  });
  expect(result.on("2026-11-17")).toEqual({
    posts: 1,
    failures: 0,
    noAction: 0,
  });
  expect(result.on("2026-11-16")).toEqual({
    posts: 0,
    failures: 1,
    noAction: 0,
  });
  expect(result.on("2026-11-15")).toEqual({
    posts: 0,
    failures: 1,
    noAction: 0,
  });
  expect(result.on("2026-11-14")).toEqual({
    posts: 0,
    failures: 0,
    noAction: 1,
  });
});

it("does not call an attempt failed while its run is still in progress", () => {
  const checkpoint = attempt({
    occurrenceId: "live",
    status: "uncertain",
    finishedAt: null,
  });
  const quiet = { posts: 0, failures: 0, noAction: 0 };
  for (const status of ["running", "queued"])
    expect(
      activity([checkpoint, run({ occurrenceId: "live", status })]).on(
        "2026-11-18",
      ),
    ).toEqual(quiet);
  // Once the run has ended, or its record is gone, the open attempt is a failure.
  for (const ended of [
    [run({ occurrenceId: "live", status: "interrupted" })],
    [run({ occurrenceId: "live", status: "blocked" })],
    [],
  ])
    expect(activity([checkpoint, ...ended]).on("2026-11-18")).toEqual({
      ...quiet,
      failures: 1,
    });
  // A confirmed attempt is a post even before its run reports back.
  expect(
    activity([
      attempt({ occurrenceId: "live" }),
      run({ occurrenceId: "live", status: "running" }),
    ]).on("2026-11-18"),
  ).toEqual({ ...quiet, posts: 1 });
});

it("leaves skips, pending runs, other modes and other sources out", () => {
  const result = activity([
    run({ occurrenceId: null, status: "skipped" }),
    run({ occurrenceId: "queued", status: "queued" }),
    run({ occurrenceId: "running", status: "running" }),
    run({ occurrenceId: "preview", mode: "preview", status: "preview" }),
    run({ occurrenceId: "reconcile", mode: "reconcile" }),
    run({ occurrenceId: "cleanup", mode: "cleanup", status: "failed" }),
    run({ occurrenceId: "legacy", timeBasis: "report-saved" }),
    attempt({ occurrenceId: "other", targetId: "other" }),
    attempt({
      occurrenceId: "old",
      at: "2026-10-20T20:00:00Z",
      finishedAt: null,
    }),
  ]);
  expect(
    result.days.every((d) => d.posts + d.failures + d.noAction === 0),
  ).toBe(true);
});

it("buckets by Pacific calendar day on both sides of a daylight-saving change", () => {
  // Clocks fall back on 2026-11-01: 23:30 is UTC-7 the night before, UTC-8 that night.
  expect(promotionDay("2026-11-01T06:30:00Z")).toBe("2026-10-31");
  expect(promotionDay("2026-11-02T07:30:00Z")).toBe("2026-11-01");
  const result = activity([
    attempt({
      occurrenceId: "before",
      at: "2026-11-01T06:30:00Z",
      finishedAt: null,
    }),
    attempt({
      occurrenceId: "after",
      at: "2026-11-02T07:30:00Z",
      finishedAt: null,
    }),
    attempt({
      occurrenceId: "next",
      at: "2026-11-02T08:30:00Z",
      finishedAt: null,
    }),
  ]);
  expect(result.on("2026-10-31")?.posts).toBe(1);
  expect(result.on("2026-11-01")?.posts).toBe(1);
  expect(result.on("2026-11-02")?.posts).toBe(1);
});

it("puts a post on the day it was confirmed, where the last-success time points", () => {
  const history = [
    attempt({ at: "2026-11-18T07:50:00Z", finishedAt: "2026-11-18T08:10:00Z" }),
  ];
  const { lastSuccessAt } = promotionHistoryTiming({
    targetId: "pmc",
    batches: [],
    history,
  });
  expect(lastSuccessAt).toBe("2026-11-18T08:10:00Z");
  const result = activity(history);
  expect(result.on("2026-11-17")?.posts).toBe(0);
  expect(result.on(promotionDay(lastSuccessAt ?? ""))?.posts).toBe(1);
});

it("reports the oldest day that still has run records", () => {
  expect(activity([], []).runDetailFrom).toBeNull();
  expect(
    activity(
      [],
      [
        batch("2026-11-12T08:00:00Z"),
        batch("2026-11-05T05:00:00Z"),
        batch("2026-11-19T16:00:00Z"),
      ],
    ).runDetailFrom,
  ).toBe("2026-11-04");
});
