import { expect, it } from "vitest";
import type { PromotionBatch } from "@shepherdjerred/ops-model/promotion/model.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";
import {
  initialPromotionState,
  type PromotionState,
} from "#shared/promotion/model.ts";
import {
  promotionNextPlanned,
  type PromotionPlanningObservation,
} from "./status-timing.ts";

const active = (times: string[]): PromotionPlanningObservation => ({
  available: true,
  enabled: true,
  enabledTargets: ["pmc", "discord-lfg-2-hour", "reddit-mcservers"],
  schedule: { status: "active", times },
});

const settledState = (at: string): Partial<PromotionState> => ({
  attempts: [
    {
      occurrenceId: "prior",
      attemptedAt: at,
      settledAt: at,
      status: "verified",
      receiptUrl: null,
      evidenceKey: null,
      contentHash: "fixture",
      beforeSubmission: [],
    },
  ],
});

function next(
  id: string,
  now: string,
  times: string[],
  changes: Partial<PromotionState> = {},
) {
  return promotionNextPlanned({
    target: promotionTarget(id),
    state: { ...initialPromotionState(id, 900), ...changes },
    batches: [],
    now: Date.parse(now),
    planning: active(times),
  });
}

it("places an overnight PMC deadline in the afternoon window and waits durably for an in-window cooldown", () => {
  const times = [
    "2026-11-14T16:00:00Z",
    "2026-11-14T20:00:00Z",
    "2026-11-15T00:00:00Z",
    "2026-11-15T04:00:00Z",
    "2026-11-16T00:00:00Z",
  ];
  expect(
    next("pmc", "2026-11-14T09:00:00Z", times, {
      nextEligibleAt: "2026-11-14T12:34:00Z",
    }).nextPlannedAt,
  ).toBe("2026-11-15T00:00:00.000Z");
  expect(
    next("pmc", "2026-11-14T09:00:00Z", times, {
      nextEligibleAt: "2026-11-15T01:34:00Z",
    }).nextPlannedAt,
  ).toBe("2026-11-15T01:34:00.000Z");
  expect(
    next("pmc", "2026-11-14T09:00:00Z", times, {
      nextEligibleAt: "2026-11-15T04:00:00Z",
    }).nextPlannedAt,
  ).toBe("2026-11-16T00:00:00.000Z");
});

it("uses actual sweep opportunities for shorter cadence and can forecast Reddit beyond the short native preview", () => {
  expect(
    next(
      "discord-lfg-2-hour",
      "2026-11-14T17:00:00Z",
      ["2026-11-14T20:00:00Z", "2026-11-15T00:00:00Z"],
      { nextEligibleAt: "2026-11-14T21:00:00Z" },
    ).nextPlannedAt,
  ).toBe("2026-11-15T00:00:00.000Z");
  expect(
    next(
      "reddit-mcservers",
      "2026-11-14T09:00:00Z",
      ["2026-11-21T00:00:00Z", "2026-11-21T04:00:00Z", "2026-11-22T00:00:00Z"],
      { nextEligibleAt: "2026-11-21T01:00:00Z" },
    ).nextPlannedAt,
  ).toBe("2026-11-21T01:00:00.000Z");
});

it("preserves elapsed cooldown through spring and fall daylight-saving transitions", () => {
  const target = promotionTarget("pmc");
  expect(target.minimumIntervalSeconds).toBe(86_400);
  // 16:00 PST Saturday -> 17:15 PDT Sunday after 24 elapsed hours plus the buffer.
  expect(
    next(
      "pmc",
      "2027-03-14T08:00:00Z",
      ["2027-03-14T23:00:00Z", "2027-03-15T03:00:00Z", "2027-03-15T23:00:00Z"],
      settledState("2027-03-14T00:00:00Z"),
    ).nextPlannedAt,
  ).toBe("2027-03-15T00:15:00.000Z");
  // 16:00 PDT Saturday -> 16:00 PST Sunday; a 24-hour day step would be wrong.
  expect(
    next(
      "pmc",
      "2027-11-07T08:00:00Z",
      ["2027-11-08T00:00:00Z", "2027-11-08T04:00:00Z"],
      settledState("2027-11-06T23:00:00Z"),
    ).nextPlannedAt,
  ).toBe("2027-11-08T00:00:00.000Z");
});

it("respects the Pacific daily attempt cap even when the stored deadline has passed", () => {
  expect(
    next(
      "pmc",
      "2026-11-14T20:00:00Z",
      ["2026-11-15T00:00:00Z", "2026-11-16T00:00:00Z"],
      {
        attempts: [
          {
            occurrenceId: "morning",
            attemptedAt: "2026-11-14T16:00:00Z",
            settledAt: "2026-11-14T16:00:00Z",
            status: "verified",
            receiptUrl: null,
            evidenceKey: null,
            contentHash: "fixture",
            beforeSubmission: [],
          },
        ],
      },
    ).nextPlannedAt,
  ).toBe("2026-11-16T00:00:00.000Z");
});

it("explains disabled, excluded, paused, unavailable and unknown-deadline sources without a fake date", () => {
  const input = {
    target: promotionTarget("pmc"),
    state: initialPromotionState("pmc", 900),
    batches: [],
    now: Date.parse("2026-11-14T09:00:00Z"),
  };
  const plan = active(["2026-11-15T00:00:00Z"]);
  expect(promotionNextPlanned(input).nextPlannedReason).toBe(
    "Schedule unavailable",
  );
  expect(
    promotionNextPlanned({ ...input, planning: { ...plan, available: false } })
      .nextPlannedReason,
  ).toBe("Configuration unavailable");
  expect(
    promotionNextPlanned({ ...input, planning: { ...plan, enabled: false } })
      .nextPlannedReason,
  ).toBe("Automation disabled");
  expect(
    promotionNextPlanned({
      ...input,
      planning: { ...plan, enabledTargets: [] },
    }).nextPlannedReason,
  ).toBe("Not enabled");
  expect(
    promotionNextPlanned({
      ...input,
      planning: { ...plan, schedule: { status: "paused" } },
    }).nextPlannedReason,
  ).toBe("Schedule paused");
  expect(
    promotionNextPlanned({
      ...input,
      planning: plan,
      state: { ...input.state, paused: true },
    }).nextPlannedAt,
  ).toBeNull();
  expect(
    promotionNextPlanned({
      ...input,
      planning: plan,
      state: {
        ...input.state,
        blockedReason: "Site cooldown was reported without a future deadline",
      },
    }).nextPlannedReason,
  ).toBe("Awaiting cooldown deadline");
});

it("distinguishes queued/running work from unresolved ownership and gives uncertainty precedence", () => {
  const state = initialPromotionState("pmc", 900);
  const batch: PromotionBatch = {
    version: 1,
    id: "active",
    pid: 1,
    mode: "run",
    startedAt: "2026-11-14T09:00:00Z",
    updatedAt: "2026-11-14T09:00:00Z",
    finishedAt: null,
    entries: [
      {
        targetId: "pmc",
        status: "queued",
        phase: "Waiting",
        startedAt: null,
        finishedAt: null,
        occurrenceId: null,
        summary: "Queued",
      },
    ],
  };
  const input = {
    target: promotionTarget("pmc"),
    state,
    batches: [batch],
    now: Date.parse("2026-11-14T09:00:00Z"),
    planning: { ...active([]), enabled: false },
  };
  expect(promotionNextPlanned(input).nextPlannedReason).toBe("Queued");
  const entry = batch.entries[0];
  if (entry === undefined) throw new Error("Missing fixture entry");
  entry.status = "running";
  expect(promotionNextPlanned(input).nextPlannedReason).toBe("In progress");
  state.attempts = [
    {
      occurrenceId: "uncertain",
      attemptedAt: "2026-11-14T09:00:00Z",
      settledAt: null,
      status: "uncertain",
      receiptUrl: null,
      evidenceKey: null,
      contentHash: "fixture",
      beforeSubmission: [],
    },
  ];
  expect(promotionNextPlanned(input).nextPlannedReason).toBe(
    "Awaiting reconciliation",
  );
  state.attempts = [];
  state.lock = {
    occurrenceId: "outstanding",
    acquiredAt: "2026-11-14T09:00:00Z",
  };
  expect(
    promotionNextPlanned({ ...input, batches: [] }).nextPlannedReason,
  ).toBe("Awaiting owner settlement");
});
