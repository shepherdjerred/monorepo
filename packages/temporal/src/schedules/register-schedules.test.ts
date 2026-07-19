import { describe, test, expect } from "bun:test";
import type { Duration } from "@temporalio/common";
import { DataDragonWorkflowInputSchema } from "#activities/data-dragon.ts";
import { DYNAMIC_AGENT_TASK_MEMO_KEY } from "#shared/agent-task.ts";
import {
  DELETED_SCHEDULE_IDS,
  SCHEDULES,
  buildSchedulePolicies,
} from "./register-schedules.ts";
import { isOrphanSchedule } from "./orphan-detection.ts";

const DYNAMIC_AGENT_TASK_MEMO = {
  [DYNAMIC_AGENT_TASK_MEMO_KEY]: true,
} as const;

function findScheduleById(id: string) {
  const schedule = SCHEDULES.find((candidate) => candidate.id === id);
  if (schedule === undefined) {
    throw new Error(`Missing schedule ${id}`);
  }
  return schedule;
}

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
  // preheat: 13 × 15m presence-checked hold chunks (195 minutes) + turn-off backstop
  goodMorningPreheat: 195 * ONE_MINUTE,
  // wake-up: ~30 sec of media ramp + MORNING_HEAT_DURATION (60 minutes) heat hold
  goodMorningWakeUp: 60 * ONE_MINUTE,
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
  "runReadmeRefresh",
  // Clones the monorepo, runs the deterministic catalog cross-check, opens a
  // PR on drift. No long sleeps of its own — the single refreshLlmCatalog
  // activity carries its own startToCloseTimeout + retry budget.
  "runLlmCatalogRefresh",
  // Awaits a single refreshHomelabCrdImports activity (clone + cdk8s imports
  // + PR on drift). No workflow-level sleeps; the activity carries its own
  // startToCloseTimeout + retry budget.
  "runHomelabCrdImportsRefresh",
  // Awaits a single refreshScoutShowcase activity (clone + scout install +
  // S3 downloads + PR on drift). No workflow-level sleeps; the activity
  // carries its own startToCloseTimeout + retry budget.
  "runScoutShowcaseRefresh",
  "runScoutSeasonRefreshWorkflow",
  "runZfsMaintenanceWorkflow",
  "runBugsinkHousekeepingWorkflow",
  // Awaits a single pruneScoutImages activity (list+delete). No workflow-level
  // sleeps; the activity carries its own startToCloseTimeout + retry budget.
  "runScoutImageGcWorkflow",
  "runVeleroOrphanAuditWorkflow",
  "syncGolinks",
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

describe("DELETED_SCHEDULE_IDS", () => {
  test("none of the deleted ids appear in active SCHEDULES", () => {
    const activeIds = SCHEDULES.map((s) => s.id);
    for (const deletedId of DELETED_SCHEDULE_IDS) {
      expect(activeIds).not.toContain(deletedId);
    }
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
    expect(schedule.workflowExecutionTimeout).toBe("50 minutes");
    expect(schedule.args[0]).toMatchObject({
      maxTurns: 8,
      agentTimeoutMinutes: 45,
    });
    expect(JSON.stringify(schedule.args[0])).toContain("Ignore Bugsink");
  });
});

describe("catchup window policy", () => {
  test.each([
    "vacuum-9am",
    "vacuum-12pm",
    "vacuum-5pm",
    "good-morning-weekday-wake",
    "good-morning-weekday-up",
    "good-morning-weekend-wake",
    "good-morning-weekend-up",
  ])("time-of-day home schedule %s gets the tight 5-minute window", (id) => {
    expect(buildSchedulePolicies(findScheduleById(id)).catchupWindow).toBe(
      "5 minutes",
    );
  });

  test.each([
    "dns-audit-daily",
    "homelab-audit-daily",
    "zfs-maintenance-weekly",
    "deps-summary-weekly",
    "scout-data-dragon-version-check",
  ])("report/maintenance schedule %s inherits the relaxed window", (id) => {
    expect(buildSchedulePolicies(findScheduleById(id)).catchupWindow).toBe(
      "1 hour",
    );
  });

  test("tight window is strictly shorter than the relaxed default", () => {
    const tight = buildSchedulePolicies(
      findScheduleById("vacuum-9am"),
    ).catchupWindow;
    const relaxed = buildSchedulePolicies(
      findScheduleById("dns-audit-daily"),
    ).catchupWindow;
    expect(durationToMs(tight)).toBeLessThan(durationToMs(relaxed));
  });

  test("every schedule resolves to a positive catchup window", () => {
    for (const schedule of SCHEDULES) {
      expect(
        durationToMs(buildSchedulePolicies(schedule).catchupWindow),
      ).toBeGreaterThan(0);
    }
  });
});

describe("orphan schedule detection", () => {
  const declaredIds = new Set(SCHEDULES.map((schedule) => schedule.id));
  const deletedIds = new Set<string>(DELETED_SCHEDULE_IDS);

  test("both pokeemerald wasm schedules are queued for deletion", () => {
    // The pokeemerald.wasm download workflow is gone — the wasm was built
    // from source in the old CI image build. Both the weekly and the older monthly
    // schedule must be deleted (and absent from SCHEDULES) so neither keeps
    // firing a workflow that's no longer in the bundle.
    for (const id of [
      "pokeemerald-wasm-weekly",
      "pokeemerald-wasm-monthly",
    ] as const) {
      expect(DELETED_SCHEDULE_IDS).toContain(id);
      expect(SCHEDULES.map((s) => s.id)).not.toContain(id);
    }
  });

  test("declared schedules are never flagged as orphans", () => {
    for (const schedule of SCHEDULES) {
      expect(
        isOrphanSchedule(schedule.id, undefined, declaredIds, deletedIds),
      ).toBe(false);
    }
  });

  test("ids on the delete allow-list are never flagged as orphans", () => {
    for (const id of DELETED_SCHEDULE_IDS) {
      expect(isOrphanSchedule(id, undefined, declaredIds, deletedIds)).toBe(
        false,
      );
    }
  });

  test("dynamic agent-task schedules are never flagged as orphans", () => {
    // Auto-generated id prefix (agentTaskScheduleId) — exempt even without memo,
    // covering schedules created before the dynamic memo marker existed.
    expect(
      isOrphanSchedule(
        "agent-task-foo-abc123",
        undefined,
        declaredIds,
        deletedIds,
      ),
    ).toBe(false);
    // A custom scheduleId passed via the /agent-tasks API has no `agent-task-`
    // prefix, so it relies on the dynamic memo marker stamped at creation.
    expect(
      isOrphanSchedule(
        "recheck-birmel-metrics",
        DYNAMIC_AGENT_TASK_MEMO,
        declaredIds,
        deletedIds,
      ),
    ).toBe(false);
  });

  test("a declared agent-task schedule removed from SCHEDULES is still flagged", () => {
    // Regression guard: a *declared*, source-controlled schedule that runs
    // agentTaskWorkflow (homelab-audit-daily) must NOT be silently exempted just
    // because of its workflow type. If it were removed from SCHEDULES without
    // being added to DELETED_SCHEDULE_IDS — and it carries no `agent-task-`
    // prefix and no dynamic memo marker — the orphan gauge must catch it.
    expect(
      isOrphanSchedule(
        "homelab-audit-daily",
        undefined,
        new Set<string>(),
        new Set<string>(),
      ),
    ).toBe(true);
  });

  test("a custom-id agent-task schedule without the memo marker is flagged", () => {
    // The workflow type alone no longer exempts a schedule; a custom-id dynamic
    // schedule that predates (or is missing) the marker surfaces as an orphan so
    // the gap that hid declared agent-task schedules can't reopen.
    expect(
      isOrphanSchedule(
        "recheck-birmel-metrics",
        undefined,
        declaredIds,
        deletedIds,
      ),
    ).toBe(true);
  });

  test("a live schedule absent from source and the delete list is an orphan", () => {
    expect(
      isOrphanSchedule(
        "some-removed-schedule",
        undefined,
        declaredIds,
        deletedIds,
      ),
    ).toBe(true);
  });
});
