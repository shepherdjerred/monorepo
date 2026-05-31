import { describe, test, expect } from "bun:test";
import type { Duration } from "@temporalio/common";
import { DataDragonWorkflowInputSchema } from "#activities/data-dragon.ts";
import {
  SCHEDULES,
  scheduleRequiresConfigPause,
} from "./register-schedules.ts";

// ---------------------------------------------------------------------------
// Maximum total sleep time per workflow type, in milliseconds.
//
// Update this map whenever a workflow's `await sleep(...)` durations change.
// The test below asserts each schedule's `workflowExecutionTimeout` exceeds
// this number plus a slack budget — preventing the regression where
// goodMorningEarly's 30m timeout was less than its 60m bathroom-heat sleep
// (incident: 2026-05-08).
//
// Every scheduled workflow must be listed either here or in
// WORKFLOWS_WITHOUT_LONG_SLEEPS below. New schedules should make that
// classification explicit so this test cannot silently skip them.
// ---------------------------------------------------------------------------
const ONE_MINUTE = 60 * 1000;
const ONE_HOUR = 60 * ONE_MINUTE;

const WORKFLOW_MAX_SLEEP_MS: Record<string, number> = {
  // good-morning.ts: MORNING_HEAT_DURATION = 60 minutes
  goodMorningEarly: 60 * ONE_MINUTE,
  // wake-up: ~5+2 sec + 4 × 5-second volume steps = ~30 seconds, well under 1m
  goodMorningWakeUp: ONE_MINUTE,
  // get-up: ~5 sec sleep between volume ramps; <1m total
  goodMorningGetUp: ONE_MINUTE,
  // run-vacuum: verifyState delaySeconds=180 + 3 inter-attempt retry sleeps.
  // Activity time and retries are covered by SLACK_MS below.
  runVacuumIfNotHome: 7 * ONE_MINUTE,
};

const WORKFLOWS_WITHOUT_LONG_SLEEPS = new Set([
  "fetchSkillCappedManifest",
  "generateDependencySummary",
  "runDnsAudit",
  "runHomelabAuditWorkflow",
  "agentTaskWorkflow",
  "runScoutDataDragonVersionCheck",
  "runScoutDataDragonWeeklyRefresh",
  "runScoutSeasonRefreshWorkflow",
  "runZfsMaintenanceWorkflow",
  "runBugsinkHousekeepingWorkflow",
  "runVeleroOrphanAuditWorkflow",
  "syncGolinks",
  "prReviewEvalWorkflow",
  "prReviewWeeklySignificanceWorkflow",
]);

const SLACK_MS = 5 * ONE_MINUTE;

// Tiny Temporal-Duration parser. Supports the string forms we use in the
// schedule registry (e.g. "5 minutes", "3 hours", "30 seconds"). Numeric
// inputs are interpreted as milliseconds (matches @temporalio/common).
function durationToMs(d: Duration): number {
  if (typeof d === "number") return d;
  const duration: string = d;
  const match = /^(\d+)\s*(second|minute|hour|day)s?$/.exec(duration.trim());
  if (match === null) {
    throw new Error(`Unrecognized Temporal duration string: "${duration}"`);
  }
  const n = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === "second"
      ? 1000
      : unit === "minute"
        ? ONE_MINUTE
        : unit === "hour"
          ? ONE_HOUR
          : 24 * ONE_HOUR;
  return n * multiplier;
}

describe("schedule timeout vs workflow sleep", () => {
  test.each(SCHEDULES)(
    "$id timeout exceeds known sleeps + slack",
    (schedule) => {
      const maxSleep = WORKFLOW_MAX_SLEEP_MS[schedule.workflowType];
      if (maxSleep === undefined) {
        expect(WORKFLOWS_WITHOUT_LONG_SLEEPS).toContain(schedule.workflowType);
        return;
      }
      if (schedule.workflowExecutionTimeout === undefined) {
        throw new Error(
          `${schedule.id}: workflowExecutionTimeout is unset but workflow ${schedule.workflowType} sleeps up to ${String(maxSleep)}ms`,
        );
      }
      const timeoutMs = durationToMs(schedule.workflowExecutionTimeout);
      const required = maxSleep + SLACK_MS;
      expect(timeoutMs).toBeGreaterThanOrEqual(required);
    },
  );
});

describe("durationToMs parser", () => {
  test("parses standard formats", () => {
    expect(durationToMs("5 minutes")).toBe(5 * ONE_MINUTE);
    expect(durationToMs("75 minutes")).toBe(75 * ONE_MINUTE);
    expect(durationToMs("3 hours")).toBe(3 * ONE_HOUR);
    expect(durationToMs("30 seconds")).toBe(30 * 1000);
    expect(durationToMs("1 minute")).toBe(ONE_MINUTE);
  });

  test("treats numbers as milliseconds", () => {
    expect(durationToMs(60_000)).toBe(60_000);
  });
});

describe("Scout Data Dragon lane-prior schedule config", () => {
  test.each([
    "scout-data-dragon-version-check",
    "scout-data-dragon-weekly-refresh",
  ])("%s passes explicit lane-prior eval inputs", (scheduleId) => {
    const schedule = SCHEDULES.find((candidate) => candidate.id === scheduleId);
    if (schedule === undefined) {
      throw new Error(`Missing schedule ${scheduleId}`);
    }
    const input = DataDragonWorkflowInputSchema.parse(schedule.args[0]);
    expect(input.lanePriors).toMatchObject({
      bucket: "scout-prod",
      queueIds: [400, 420, 440, 480, 490],
      trainingStartDate: "2026-05-06",
      trainingEndDate: "2026-05-13",
      holdoutStartDate: "2026-05-14",
      holdoutEndDate: "2026-05-16",
      holdoutSampleSize: 100,
      holdoutSeed: "scout-lane-priors-patch-cadence-v1",
      threshold: 0.95,
    });
  });
});

describe("PR review eval schedule config", () => {
  test("pauses nightly eval when the private fixture repo URL is absent", () => {
    const schedule = SCHEDULES.find(
      (candidate) => candidate.id === "pr-review-eval-nightly",
    );
    if (schedule === undefined) {
      throw new Error("Missing pr-review-eval-nightly schedule");
    }
    expect(scheduleRequiresConfigPause(schedule, {})).toEqual({
      paused: true,
      reason:
        "Paused because PR_REVIEW_FIXTURES_REPO_URL is not configured on the Temporal worker",
    });
  });

  test("does not pause nightly eval when the private fixture repo URL is present", () => {
    const schedule = SCHEDULES.find(
      (candidate) => candidate.id === "pr-review-eval-nightly",
    );
    if (schedule === undefined) {
      throw new Error("Missing pr-review-eval-nightly schedule");
    }
    expect(
      scheduleRequiresConfigPause(schedule, {
        PR_REVIEW_FIXTURES_REPO_URL: "https://github.com/example/private.git",
        PR_REVIEW_EVAL_DATABASE_URL: "postgres://example",
      }),
    ).toEqual({ paused: false, reason: undefined });
  });

  test("pauses nightly eval when the eval database URL is absent", () => {
    const schedule = SCHEDULES.find(
      (candidate) => candidate.id === "pr-review-eval-nightly",
    );
    if (schedule === undefined) {
      throw new Error("Missing pr-review-eval-nightly schedule");
    }
    expect(
      scheduleRequiresConfigPause(schedule, {
        PR_REVIEW_FIXTURES_REPO_URL: "https://github.com/example/private.git",
      }),
    ).toEqual({
      paused: true,
      reason:
        "Paused because PR_REVIEW_EVAL_DATABASE_URL is not configured on the Temporal worker",
    });
  });
});

describe("PR review A/B weekly report schedule config", () => {
  test("pauses the weekly report when the eval database URL is absent", () => {
    const schedule = SCHEDULES.find(
      (candidate) => candidate.id === "pr-review-ab-weekly-report",
    );
    if (schedule === undefined) {
      throw new Error("Missing pr-review-ab-weekly-report schedule");
    }
    expect(scheduleRequiresConfigPause(schedule, {})).toEqual({
      paused: true,
      reason:
        "Paused because PR_REVIEW_EVAL_DATABASE_URL is not configured on the Temporal worker",
    });
  });

  test("does not pause the weekly report when the eval database URL is present", () => {
    const schedule = SCHEDULES.find(
      (candidate) => candidate.id === "pr-review-ab-weekly-report",
    );
    if (schedule === undefined) {
      throw new Error("Missing pr-review-ab-weekly-report schedule");
    }
    expect(
      scheduleRequiresConfigPause(schedule, {
        PR_REVIEW_EVAL_DATABASE_URL: "postgres://example",
      }),
    ).toEqual({ paused: false, reason: undefined });
  });
});

describe("homelab daily audit schedule config", () => {
  test("uses a bounded daily report input and timeout", () => {
    const schedule = SCHEDULES.find(
      (candidate) => candidate.id === "homelab-audit-daily",
    );
    if (schedule === undefined) {
      throw new Error("Missing homelab-audit-daily schedule");
    }
    expect(schedule.workflowExecutionTimeout).toBe("10 minutes");
    expect(schedule.args[0]).toMatchObject({
      maxTurns: 8,
      agentTimeoutMinutes: 8,
    });
    expect(JSON.stringify(schedule.args[0])).toContain("Ignore Bugsink");
  });
});
