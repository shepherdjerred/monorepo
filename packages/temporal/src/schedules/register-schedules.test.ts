import { describe, test, expect, it } from "vitest";
import type { Duration } from "@temporalio/common";
import {
  ScheduleOverlapPolicy,
  type ScheduleUpdateOptions,
} from "@temporalio/client";
import { LanePriorWorkflowInputSchema } from "#activities/lane-prior-refresh.ts";
import { DYNAMIC_AGENT_TASK_MEMO_KEY } from "#shared/agent-task-identifiers.ts";
import {
  DELETED_SCHEDULE_IDS,
  buildSchedulePolicies,
  routeDynamicAgentTaskSchedule,
} from "./register-schedules.ts";
import { SCHEDULES } from "./schedule-definitions.ts";
import {
  isOrphanSchedule,
  isOwnedScoutReportSchedule,
  isReconcilableDynamicAgentTaskSchedule,
} from "./orphan-detection.ts";
import { buildScheduleState } from "./schedule-state.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const DYNAMIC_AGENT_TASK_MEMO = {
  [DYNAMIC_AGENT_TASK_MEMO_KEY]: true,
} as const;

const OWNED_SCOUT_REPORT_MEMO = {
  owner: "scout-for-lol",
  stage: "beta",
  reportId: "report_123",
  schemaVersion: 1,
} as const;

test("Scout report schedules require an exact id and ownership memo match", () => {
  expect(
    isOwnedScoutReportSchedule(
      "scout-beta-report-report_123",
      OWNED_SCOUT_REPORT_MEMO,
    ),
  ).toBe(true);
  expect(
    isOwnedScoutReportSchedule(
      "scout-prod-report-report_123",
      OWNED_SCOUT_REPORT_MEMO,
    ),
  ).toBe(false);
  expect(
    isOwnedScoutReportSchedule("scout-beta-report-report_123", {
      ...OWNED_SCOUT_REPORT_MEMO,
      owner: "unknown",
    }),
  ).toBe(false);
});

function findScheduleById(id: string) {
  const schedule = SCHEDULES.find((candidate) => candidate.id === id);
  if (schedule === undefined) {
    throw new Error(`Missing schedule ${id}`);
  }
  return schedule;
}

describe("central Workflow schedule routing", () => {
  const definitions = [
    ["buildkite-bun-cache-gc", "runBunCacheGcWorkflow", "1 hour"],
    ["kometa-daily", "runKometaWorkflow", "2 hours"],
    ["buildkite-uv-cache-prune-weekly", "runUvCachePruneWorkflow", "2 hours"],
    ["buildkite-trivy-db-refresh", "runTrivyDbRefreshWorkflow", "2 hours"],
    ["turbo-cache-clean-daily", "runTurboCacheCleanWorkflow", "30 minutes"],
  ] as const;

  it.each(definitions)(
    "%s keeps its workflow identity on the deterministic Workflow queue",
    (id, workflowType, workflowExecutionTimeout) => {
      const schedule = findScheduleById(id);
      expect(schedule.workflowType).toBe(workflowType);
      expect(schedule.taskQueue).toBe(TASK_QUEUES.WORKFLOWS);
      expect(schedule.requiredEnvironment).toBeUndefined();
      expect(schedule.workflowExecutionTimeout).toBe(workflowExecutionTimeout);
    },
  );
});

describe("central schedule routing", () => {
  it.each([
    "vacuum-9am",
    "vacuum-12pm",
    "vacuum-5pm",
    "good-morning-weekday-preheat",
    "good-morning-weekday-wake",
    "good-morning-weekday-up",
    "good-morning-weekend-preheat",
    "good-morning-weekend-wake",
    "good-morning-weekend-up",
  ])("routes %s to the shared Workflow queue", (id) => {
    expect(findScheduleById(id).taskQueue).toBe(TASK_QUEUES.WORKFLOWS);
  });

  it.each(["report-freshness-monitor", "temporal-failure-watch"])(
    "routes %s to the shared Workflow queue",
    (id) => {
      expect(findScheduleById(id).taskQueue).toBe(TASK_QUEUES.WORKFLOWS);
    },
  );

  test("routes every central schedule to the shared Workflow queue", () => {
    const centralSchedules = SCHEDULES.filter(
      (schedule) =>
        schedule.taskQueue !== TASK_QUEUES.SCOUT_BETA &&
        schedule.taskQueue !== TASK_QUEUES.SCOUT_PROD,
    );
    expect(
      new Set(centralSchedules.map((schedule) => schedule.taskQueue)),
    ).toEqual(new Set([TASK_QUEUES.WORKFLOWS]));
  });
});

test("dynamic agent schedules preserve state while moving future runs", () => {
  const existing: ScheduleUpdateOptions = {
    spec: {
      cronExpressions: ["0 9 * * *"],
      timezone: "America/Los_Angeles",
    },
    action: {
      type: "startWorkflow",
      workflowType: "agentTaskWorkflow",
      taskQueue: TASK_QUEUES.AGENT_TASK,
      args: [{ title: "Inspect production" }],
    },
    policies: { overlap: ScheduleOverlapPolicy.SKIP },
    state: { paused: true, note: "operator pause" },
  };

  expect(routeDynamicAgentTaskSchedule(existing)).toEqual({
    ...existing,
    action: {
      ...existing.action,
      taskQueue: TASK_QUEUES.WORKFLOWS,
    },
  });
});

test("dynamic schedule reconciliation rejects a forged ownership marker", () => {
  const unrelated: ScheduleUpdateOptions = {
    spec: { intervals: [{ every: "1 hour" }] },
    action: {
      type: "startWorkflow",
      workflowType: "runDnsAudit",
      taskQueue: TASK_QUEUES.INFRA,
      args: [],
    },
    state: {},
  };

  expect(() => routeDynamicAgentTaskSchedule(unrelated)).toThrow(
    "must start agentTaskWorkflow",
  );
});

describe("declared schedules are never reconciled as dynamic agent tasks", () => {
  const declaredIds = new Set(SCHEDULES.map((schedule) => schedule.id));

  test("an undeclared schedule carrying the marker is still reconciled", () => {
    expect(
      isReconcilableDynamicAgentTaskSchedule(
        "agent-task-adhoc-1",
        DYNAMIC_AGENT_TASK_MEMO,
        declaredIds,
      ),
    ).toBe(true);
    expect(
      isReconcilableDynamicAgentTaskSchedule(
        "some-agent-created-id",
        DYNAMIC_AGENT_TASK_MEMO,
        declaredIds,
      ),
    ).toBe(true);
  });

  // Regression: ci-io-post-merge-impact was created as a dynamic agent task and
  // later promoted into SCHEDULES. Temporal memos are immutable after creation,
  // so its live memo still carries the marker while its action starts
  // runCiIoImpact. Reconciling it threw "must start agentTaskWorkflow" and
  // crash-looped the worker before it could register any schedule.
  test("a declared schedule with a stale marker is skipped", () => {
    expect(declaredIds.has("ci-io-post-merge-impact")).toBe(true);
    expect(
      isReconcilableDynamicAgentTaskSchedule(
        "ci-io-post-merge-impact",
        {
          ...DYNAMIC_AGENT_TASK_MEMO,
          description: "Agent task: Measure CI I/O optimization impact",
        },
        declaredIds,
      ),
    ).toBe(false);
  });

  test("every declared schedule is skipped even if it looks dynamic", () => {
    for (const schedule of SCHEDULES) {
      expect(
        isReconcilableDynamicAgentTaskSchedule(
          schedule.id,
          DYNAMIC_AGENT_TASK_MEMO,
          declaredIds,
        ),
      ).toBe(false);
    }
  });

  // The precedence must match isOrphanSchedule's, which already resolves
  // declared-vs-dynamic the same way.
  test("declared precedence matches orphan detection", () => {
    expect(
      isOrphanSchedule(
        "ci-io-post-merge-impact",
        DYNAMIC_AGENT_TASK_MEMO,
        declaredIds,
        new Set(DELETED_SCHEDULE_IDS),
      ),
    ).toBe(false);
  });
});

test("dependency summary timeout covers every retried report phase", () => {
  expect(findScheduleById("deps-summary-weekly").workflowExecutionTimeout).toBe(
    "3 hours",
  );
});

test("FreshRSS sync keeps its bounded pre-refresh schedule", () => {
  const schedule = findScheduleById("freshrss-sync-hourly");
  expect(schedule.workflowType).toBe("runFreshRssSyncWorkflow");
  expect(schedule.timing).toEqual({
    kind: "cron",
    expression: "7 * * * *",
    timezone: "America/Los_Angeles",
  });
  expect(schedule.taskQueue).toBe(TASK_QUEUES.WORKFLOWS);
  expect(schedule.catchupWindow).toBe("5 minutes");
  expect(schedule.workflowExecutionTimeout).toBe("6 minutes");
});

test("Flipt inventory drift starts on the shared Workflow queue", () => {
  expect(findScheduleById("flipt-flag-inventory-daily")).toMatchObject({
    workflowType: "runFliptFlagInventory",
    args: [],
    timing: {
      kind: "cron",
      expression: "15 6 * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "15 minutes",
  });
});

test("protobuf watch timeout covers collection and both delivery paths", () => {
  const timeout = findScheduleById(
    "protobufjs-v8-watch-weekly",
  ).workflowExecutionTimeout;
  expect(timeout).toBe("25 minutes");
  if (timeout === undefined) {
    throw new Error("protobufjs-v8-watch-weekly lacks a timeout");
  }
  expect(durationToMs(timeout)).toBeGreaterThan(15 * ONE_MINUTE);
});

test.each([
  ["scout-season-refresh-weekly", "90 minutes", 78],
  ["scout-queue-windows-daily", "90 minutes", 75],
] as const)(
  "%s timeout covers work retries and both report-delivery paths",
  (scheduleId, expectedTimeout, minimumBudgetMinutes) => {
    const timeout = findScheduleById(scheduleId).workflowExecutionTimeout;
    expect(timeout).toBe(expectedTimeout);
    if (timeout === undefined) throw new Error(`${scheduleId} lacks a timeout`);
    expect(durationToMs(timeout)).toBeGreaterThanOrEqual(
      minimumBudgetMinutes * ONE_MINUTE,
    );
  },
);

function configuredEnvironment(
  schedule: ReturnType<typeof findScheduleById>,
): Record<string, string> {
  return Object.fromEntries([
    ...(schedule.requiredEnvironment ?? []).map((name) => [name, "set"]),
    ...(schedule.requiredPresentEnvironment ?? []).map((name) => [name, ""]),
  ]);
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
  // Sunday noon through the next Sunday 11:00 PT. The fall DST transition
  // makes the maximum elapsed duration 168 hours.
  runScoutWeeklyParlayWorkflow: 168 * ONE_HOUR,
};

// Weekly finalization continues as new without a chain-wide execution timeout;
// this is deliberate so a prolonged Scout outage cannot strand bets.
const WORKFLOWS_WITHOUT_EXECUTION_TIMEOUT = new Set([
  "runScoutWeeklyParlayWorkflow",
]);

const WORKFLOWS_WITHOUT_LONG_SLEEPS = new Set([
  "fetchSkillCappedManifest",
  "runFreshRssSyncWorkflow",
  "runFliptFlagInventory",
  // These workflows await one direct maintenance activity; the activity
  // timeout and retry policy are the relevant execution budget.
  "runBunCacheGcWorkflow",
  "runKometaWorkflow",
  "runUvCachePruneWorkflow",
  "runTrivyDbRefreshWorkflow",
  "runMainVulnScanWorkflow",
  "runLinkRotScanWorkflow",
  "runTurboCacheCleanWorkflow",
  // Awaits one scan activity (clone + trivy fs) then report delivery and the
  // Alertmanager publish. No workflow-level sleeps; each activity carries its
  // own startToCloseTimeout + retry budget.
  "runMainVulnScanWorkflow",
  // Same shape as runMainVulnScanWorkflow: one lychee scan activity, then
  // report delivery and the Alertmanager publish. No workflow-level sleeps.
  "runLinkRotScanWorkflow",
  "monitorReportFreshness",
  "generateDependencySummary",
  "runProtobufWatch",
  "runTasknotesCanary",
  "runCiIoImpact",
  "runDnsAudit",
  "runHomelabAuditWorkflow",
  "agentTaskWorkflow",
  "runScoutDataDragonVersionCheck",
  "runScoutDataDragonWeeklyRefresh",
  "runScoutLanePriorsWeeklyRefresh",
  // Clones the monorepo, runs the deterministic catalog cross-check, opens a
  // PR on drift. No long sleeps of its own — the single refreshLlmCatalog
  // activity carries its own startToCloseTimeout + retry budget.
  "runLlmCatalogRefresh",
  // Awaits a single refreshHomelabCrdImports activity (clone + cdk8s imports
  // + PR on drift). No workflow-level sleeps; the activity carries its own
  // startToCloseTimeout + retry budget.
  "runHomelabCrdImportsRefresh",
  // Awaits a single refreshPokeemeraldData activity (clone + four raw
  // fetches + PR on drift). No workflow-level sleeps; the activity carries
  // its own startToCloseTimeout + retry budget.
  "runPokeemeraldDataRefresh",
  // Awaits a single refreshScoutShowcase activity (clone + scout install +
  // S3 downloads + PR on drift). No workflow-level sleeps; the activity
  // carries its own startToCloseTimeout + retry budget.
  "runScoutShowcaseRefresh",
  "runScoutQueueWindowsWatch",
  "runScoutCompetitionUpdatesWorkflow",
  "runScoutSeasonRefreshWorkflow",
  "runScoutBryanBucksAnalyticsWorkflow",
  "runZfsMaintenanceWorkflow",
  "runBugsinkHousekeepingWorkflow",
  // Awaits a single pruneScoutImages activity (list+delete). No workflow-level
  // sleeps; the activity carries its own startToCloseTimeout + retry budget.
  "runScoutImageGcWorkflow",
  "runVeleroOrphanAuditWorkflow",
  "syncGolinks",
  // Awaits a single runObserveReviewSignals activity (list PRs + per-PR
  // GitHub reads + one S3 NDJSON write). No workflow-level sleeps; the
  // activity carries its own startToCloseTimeout + retry budget.
  "observeReviewSignalsWorkflow",
  "runGlitterCorpusDaily",
  "runGlitterContextRefresh",
  // Awaits a single pollWorkflowFailures activity (visibility list + per-
  // execution result() calls + one Alertmanager POST). No workflow-level
  // sleeps; the activity carries its own startToCloseTimeout + retry budget.
  "pollWorkflowFailuresWorkflow",
  // Scout's schedule entrypoints delegate immediately to queue-specific
  // activities or child workflows. Their activity retry budgets are bounded
  // independently; none sleeps inside Workflow code.
  "scoutRealtimePollWorkflow",
  "scoutPostMatchDiscoveryWorkflow",
  "scoutIngestionReconciliationWorkflow",
  "scoutBackgroundJobWorkflow",
  "scoutReportScheduleReconcilerWorkflow",
  "scoutReportLakeWorkflow",
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
        if (WORKFLOWS_WITHOUT_EXECUTION_TIMEOUT.has(schedule.workflowType)) {
          return;
        }
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

describe("Scout lane-prior schedule config", () => {
  test("passes explicit lane-prior eval inputs only to its own workflow", () => {
    const schedule = findScheduleById("scout-lane-priors-weekly-refresh");
    const input = LanePriorWorkflowInputSchema.parse(schedule.args[0]);
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
    expect(findScheduleById("scout-data-dragon-version-check").args).toEqual(
      [],
    );
    expect(findScheduleById("scout-data-dragon-weekly-refresh").args).toEqual(
      [],
    );
  });
});

describe("Scout weekly parlay schedule config", () => {
  test("starts one Pacific lifecycle at Sunday noon", () => {
    const schedule = findScheduleById("scout-weekly-parlay");
    expect(schedule).toMatchObject({
      workflowType: "runScoutWeeklyParlayWorkflow",
      args: [{}],
      timing: {
        kind: "cron",
        expression: "0 12 * * 0",
        timezone: "America/Los_Angeles",
      },
      taskQueue: TASK_QUEUES.WORKFLOWS,
      overlap: ScheduleOverlapPolicy.ALLOW_ALL,
    });
  });
});

describe("Scout Bryan Bucks analytics schedule config", () => {
  test("runs the committed-ledger sync every fifteen minutes", () => {
    expect(findScheduleById("scout-bryan-bucks-analytics")).toMatchObject({
      workflowType: "runScoutBryanBucksAnalyticsWorkflow",
      args: [],
      timing: {
        kind: "cron",
        expression: "*/15 * * * *",
        timezone: "America/Los_Angeles",
      },
      taskQueue: TASK_QUEUES.WORKFLOWS,
      overlap: ScheduleOverlapPolicy.SKIP,
      workflowExecutionTimeout: "5 minutes",
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

describe("Glitter corpus schedule", () => {
  test("uses the Workflow queue and pauses until every credential is present", () => {
    const schedule = findScheduleById("glitter-corpus-daily");
    expect(schedule.taskQueue).toBe(TASK_QUEUES.WORKFLOWS);
    expect(schedule.timing).toEqual({
      kind: "cron",
      expression: "15 4 * * *",
      timezone: "America/Los_Angeles",
    });
    const paused = buildScheduleState(schedule, {});
    expect(paused.paused).toBe(true);
    expect(paused.note).toContain("GLITTER_DISCORD_TOKEN");

    const configured = configuredEnvironment(schedule);
    expect(buildScheduleState(schedule, configured)).toEqual({
      paused: true,
      note: "Awaiting operator approval of first complete snapshot",
    });
  });

  test("accepts an explicitly blank denylist but rejects an absent denylist", () => {
    const schedule = findScheduleById("glitter-corpus-daily");
    const configured = configuredEnvironment(schedule);
    expect(configured["GLITTER_DISCORD_DENYLIST_CHANNEL_IDS"]).toBe("");
    expect(buildScheduleState(schedule, configured)).toEqual({
      paused: true,
      note: "Awaiting operator approval of first complete snapshot",
    });

    delete configured["GLITTER_DISCORD_DENYLIST_CHANNEL_IDS"];
    expect(buildScheduleState(schedule, configured)).toEqual({
      paused: true,
      note: "Paused automatically until required Glitter corpus credentials are configured: GLITTER_DISCORD_DENYLIST_CHANNEL_IDS",
    });
  });

  test("lets the gateway preserve remote-worker approval state without credentials", () => {
    const schedule = findScheduleById("glitter-corpus-daily");
    expect(buildScheduleState(schedule, {}, undefined, false)).toEqual({
      paused: true,
      note: "Awaiting operator approval of first complete snapshot",
    });
  });

  test("preserves an operator pause after configuration", () => {
    const schedule = findScheduleById("glitter-corpus-daily");
    const configured = configuredEnvironment(schedule);
    expect(
      buildScheduleState(schedule, configured, {
        paused: true,
        note: "manual safety hold",
      }),
    ).toEqual({ paused: true, note: "manual safety hold" });
  });

  test("moves the configuration pause to the explicit approval hold", () => {
    const schedule = findScheduleById("glitter-corpus-daily");
    const configured = configuredEnvironment(schedule);
    expect(
      buildScheduleState(schedule, configured, {
        paused: true,
        note: "Paused automatically until required Glitter corpus credentials are configured: GLITTER_DISCORD_TOKEN",
      }),
    ).toEqual({
      paused: true,
      note: "Awaiting operator approval of first complete snapshot",
    });
  });

  test("preserves an operator unpause after the first snapshot", () => {
    const schedule = findScheduleById("glitter-corpus-daily");
    const configured = configuredEnvironment(schedule);
    expect(
      buildScheduleState(schedule, configured, {
        paused: false,
      }),
    ).toEqual({ paused: false });
  });
});

describe("Glitter context refresh schedule", () => {
  test("uses the Workflow queue and remains paused through credential setup", () => {
    const schedule = findScheduleById("glitter-context-refresh-weekly");
    expect(schedule.taskQueue).toBe(TASK_QUEUES.WORKFLOWS);
    expect(schedule.timing).toEqual({
      kind: "cron",
      expression: "0 11 * * 1",
      timezone: "America/Los_Angeles",
    });
    expect(schedule.args).toEqual([{ maxEstimatedCostUsd: 40 }]);
    expect(schedule.workflowExecutionTimeout).toBe("15 hours");
    expect(buildScheduleState(schedule, {}).paused).toBe(true);
    expect(
      buildScheduleState(schedule, configuredEnvironment(schedule)),
    ).toEqual({
      paused: true,
      note: "Awaiting credentialed dry-run against the first approved complete snapshot",
    });
  });

  test("preserves the operator unpause after acceptance", () => {
    const schedule = findScheduleById("glitter-context-refresh-weekly");
    expect(
      buildScheduleState(schedule, configuredEnvironment(schedule), {
        paused: false,
      }),
    ).toEqual({ paused: false });
  });
});

describe("homelab daily audit schedule config", () => {
  test("uses deterministic collectors with a bounded timeout", () => {
    const schedule = SCHEDULES.find(
      (candidate) => candidate.id === "homelab-audit-daily",
    );
    if (schedule === undefined) {
      throw new Error("Missing homelab-audit-daily schedule");
    }
    expect(schedule.workflowExecutionTimeout).toBe("50 minutes");
    expect(schedule.args).toEqual([{}]);
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

  test("weekly Scout publication preserves the Sunday betting window", () => {
    expect(
      buildSchedulePolicies(findScheduleById("scout-weekly-parlay"))
        .catchupWindow,
    ).toBe("12 hours");
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
    // agentTaskWorkflow must NOT be silently exempted merely because of its
    // workflow type. If removed from SCHEDULES without being added to
    // DELETED_SCHEDULE_IDS — and it has neither the generated prefix nor the
    // dynamic memo marker — the orphan gauge must catch it.
    expect(
      isOrphanSchedule(
        "declared-report-investigation",
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
