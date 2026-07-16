import type { Client } from "@temporalio/client";
import {
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
} from "@temporalio/client";
import type { Duration } from "@temporalio/common";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { AgentTaskInput } from "#shared/agent-task.ts";
import { detectOrphanSchedules } from "./orphan-detection.ts";

// All cron expressions below are wall-clock local time for the homelab.
const SCHEDULE_TIMEZONE = "America/Los_Angeles";

// `catchupWindow` controls replay after the Temporal SERVER was down/unavailable
// across a scheduled time and then recovers (the "backfill" of missed runs). A
// normal worker restart/deploy does NOT drop runs — the server still creates the
// action on time and it queues until a worker is free. Two tiers, by intent:
//
//   * CATCHUP_TIGHT — time-of-day home automation (vacuum, good-morning). If the
//     server missed the slot by more than a few minutes, skip rather than fire
//     late; running the vacuum or a wake-up routine an hour late is worse than
//     not running. (Does not cover a long *worker* outage executing a late run;
//     that needs a staleness guard inside the workflow.)
//   * CATCHUP_RELAXED (default) — reports / maintenance / data jobs. The intent
//     is "ran this cycle," so running late after a server outage is acceptable.
//
// Inferred string-literal types, NOT `: Duration`. `Duration` is
// `StringValue | number`, and under the old CI's per-package Node16 install the canary
// `ms` resolves with no usable `StringValue` (its `exports` map has no `types`
// condition, so TS falls through to `@types/ms`, which never exported StringValue),
// leaving `Duration` partly error-typed. Any value whose static type is `Duration`
// then trips @typescript-eslint/no-unsafe-assignment in CI (green locally, where a
// StringValue-bearing `ms` resolves). Keeping these as literals — and typing the
// catchupWindow field as the CatchupWindow union below rather than `Duration` —
// keeps every catchup value off the error-typed `Duration` path entirely.
const CATCHUP_TIGHT = "5 minutes";
const CATCHUP_RELAXED = "1 hour";

// The two declared catchup tiers as a literal union (not `Duration`), so reading
// the optional schedule field in buildSchedulePolicies can never yield an
// error-typed value. Both literals are valid Temporal `Duration`s at the policies
// call site.
type CatchupWindow = typeof CATCHUP_TIGHT | typeof CATCHUP_RELAXED;

// Schedules whose workflow type was removed from the bundle. registerSchedules
// deletes these on startup so they stop firing and failing. Explicit removal
// allow-list — NOT a blind prune of "anything not in SCHEDULES", which would
// also delete the ad-hoc/cron agent-task schedules created via the /agent-tasks API.
export const DELETED_SCHEDULE_IDS = [
  "good-morning-weekday-early",
  "good-morning-weekend-early",
  // Replaced by the Buildkite `helm-types-drift-check` CI gate (the generated
  // types are now verified on every PR that touches a generator input, instead
  // of reconciled weekly). The workflow type was removed from the bundle, so
  // this schedule must be deleted or it would keep firing a missing workflow.
  "helm-types-weekly-refresh",
  // Alert-remediation workflow removed entirely: in ~1 month it opened 0 PRs
  // (metrics: ~564 `failed`, ~2 `report-only`, 0 `pr-created`). Most PagerDuty/
  // Bugsink alerts (absence signals, infra flaps, capacity) aren't fixable by a
  // repo-only PR, so the premise didn't hold. Both ids stay here so the
  // reconciler deletes the live schedules on startup rather than orphaning them.
  "alert-remediation-hourly",
  "alert-remediation-daily",
  // The pokeemerald.wasm download workflow (`runPokeemeraldWasmUpdate`) is gone:
  // the wasm was instead built from source in the (since-removed) CI image build with our
  // customizations (the download fetched an audio-stubbed upstream that lacked
  // them). Delete BOTH the live weekly schedule and the never-removed monthly
  // one (a monthly→weekly rename relic the 2026-06-26 audit caught) so neither
  // keeps firing a workflow that no longer exists in the bundle.
  "pokeemerald-wasm-weekly",
  "pokeemerald-wasm-monthly",
  // The pr-review eval bot (continuous-eval + weekly A/B significance) was
  // removed entirely — its workflow types (`prReviewEvalWorkflow`,
  // `prReviewWeeklySignificanceWorkflow`) are no longer in the bundle. Delete
  // BOTH schedules on startup so the worker stops firing missing workflow
  // types (which would also trip the `temporal_schedule_orphans` gauge). The
  // dedicated `pr_review_eval` Postgres DB and PagerDuty alert group were torn
  // down with them.
  "pr-review-eval-nightly",
  "pr-review-ab-weekly-report",
] as const;

type ScheduleDefinition = {
  id: string;
  workflowType: string;
  args: unknown[];
  cronExpression: string;
  taskQueue: string;
  overlap: ScheduleOverlapPolicy;
  memo: string;
  workflowExecutionTimeout?: Duration;
  // Server-outage replay margin. Omit to inherit CATCHUP_RELAXED; set
  // CATCHUP_TIGHT on time-of-day home automation that should skip rather than
  // fire late. See the CATCHUP_* constants above. Typed as the CatchupWindow
  // literal union (not `Duration`) to stay off the error-typed `Duration` path
  // under CI's Node16 `ms` resolution — see the constants' comment.
  catchupWindow?: CatchupWindow;
};

const SCOUT_LANE_PRIOR_UPDATE_CONFIG = {
  lanePriors: {
    bucket: "scout-prod",
    queueIds: [400, 420, 440, 480, 490],
    trainingStartDate: "2026-05-06",
    trainingEndDate: "2026-05-13",
    holdoutStartDate: "2026-05-14",
    holdoutEndDate: "2026-05-16",
    holdoutSampleSize: 100,
    holdoutSeed: "scout-lane-priors-patch-cadence-v1",
    threshold: 0.95,
  },
};

const HOMELAB_AUDIT_AGENT_TASK: AgentTaskInput = {
  title: "Daily homelab health audit",
  provider: "claude",
  mode: "report-only",
  repo: {
    fullName: "shepherdjerred/monorepo",
    ref: "main",
  },
  scheduleId: "homelab-audit-daily",
  allowSelfCancel: false,
  maxTurns: 8,
  // The audit's 8 turns take ~25 min end-to-end; the old 8-min timeout killed it mid-run.
  agentTimeoutMinutes: 45,
  emailSubjectPrefix: "Homelab Audit",
  source: {
    docPath: "packages/docs/guides/2026-04-04_homelab-audit-runbook.md",
  },
  prompt: [
    "Run a bounded daily homelab health check. The runbook at",
    "`packages/docs/guides/2026-04-04_homelab-audit-runbook.md` is command reference only;",
    "do not execute the full runbook or build the full application matrix.",
    "Use live read-only evidence from the cluster and observability tools.",
    "Do not mutate Kubernetes, GitHub, PagerDuty, Grafana, Bugsink, Cloudflare, files, or git state.",
    "Ignore Bugsink entirely for this daily report.",
    "Finish in 5-10 minutes. Use narrow commands only, and wrap slow shell commands with timeout",
    "when available, usually 30-60 seconds. Do not run broad Loki scans, full app inventories,",
    "or exhaustive historical sweeps.",
    "Check exactly these areas: firing Prometheus alerts, open PagerDuty incidents, failed/stuck",
    "Temporal workflows and schedules, unhealthy Kubernetes pods/workloads, ArgoCD degraded or",
    "sync-error apps, and Buildkite main failures.",
    "Emit progress markers in the report for each area as Checked, Skipped, or Failed so the",
    "next timeout shows the last completed category. If a tool is slow, skip it and return a",
    "partial report instead of continuing.",
    "Return concise markdown suitable for email with current status, notable regressions,",
    "remaining action items, and exact evidence commands where useful.",
  ].join(" "),
};

export const SCHEDULES: ScheduleDefinition[] = [
  {
    id: "fetcher-skill-capped",
    workflowType: "fetchSkillCappedManifest",
    args: [],
    cronExpression: "0 5 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "5 minutes",
    memo: "Fetch Better Skill Capped manifest from Firestore and upload to S3 (daily at 05:00 PT)",
  },
  {
    id: "deps-summary-weekly",
    workflowType: "generateDependencySummary",
    args: [7],
    cronExpression: "0 9 * * 1",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "30 minutes",
    memo: "Weekly dependency summary email",
  },
  {
    id: "dns-audit-daily",
    workflowType: "runDnsAudit",
    args: [],
    cronExpression: "0 6 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "5 minutes",
    memo: "Daily DNS record audit (SPF, DMARC, MX)",
  },
  {
    id: "homelab-audit-daily",
    workflowType: "agentTaskWorkflow",
    args: [HOMELAB_AUDIT_AGENT_TASK],
    // 06:30 PT — staggered after dns-audit-daily (06:00). Lands in inbox
    // before goodMorningEarly (07:00 weekdays / 08:00 weekends) fires.
    cronExpression: "30 6 * * *",
    taskQueue: TASK_QUEUES.AGENT_TASK,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "50 minutes",
    memo: "Bounded daily homelab health check email via generic report-only agent task (Claude -> Postal)",
  },
  {
    id: "scout-data-dragon-version-check",
    workflowType: "runScoutDataDragonVersionCheck",
    args: [SCOUT_LANE_PRIOR_UPDATE_CONFIG],
    cronExpression: "0 6 * * 0-5",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "3 hours",
    memo: "Check LoL Data Dragon version and update Scout assets when needed",
  },
  {
    id: "scout-data-dragon-weekly-refresh",
    workflowType: "runScoutDataDragonWeeklyRefresh",
    args: [SCOUT_LANE_PRIOR_UPDATE_CONFIG],
    cronExpression: "0 6 * * 6",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "3 hours",
    memo: "Weekly Scout Data Dragon refresh even when version is unchanged",
  },
  {
    id: "readme-refresh-weekly",
    workflowType: "runReadmeRefresh",
    args: [],
    // 08:00 PT every Monday — staggered after scout-season-refresh (07:00)
    // so the two weekly PR-opening jobs don't contend for the worker pod at once.
    cronExpression: "0 8 * * 1",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "30 minutes",
    memo: "Weekly README project-listing regeneration via cog (opens a PR if listings drifted)",
  },
  {
    id: "llm-catalog-refresh-weekly",
    workflowType: "runLlmCatalogRefresh",
    args: [],
    // 09:00 PT every Monday — staggered after scout-season-refresh (07:00) and
    // readme-refresh (08:00) so the weekly PR-opening jobs don't contend.
    cronExpression: "0 9 * * 1",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "30 minutes",
    memo: "Weekly LLM model-catalog pricing cross-check vs models.dev + LiteLLM (opens a PR on drift)",
  },
  {
    id: "scout-season-refresh-weekly",
    workflowType: "runScoutSeasonRefreshWorkflow",
    args: [],
    cronExpression: "0 7 * * 1",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "30 minutes",
    memo: "Weekly LoL season-date drift check (claude -p → PR if drifted)",
  },
  {
    id: "zfs-maintenance-weekly",
    workflowType: "runZfsMaintenanceWorkflow",
    args: [],
    cronExpression: "0 3 * * 0",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "30 minutes",
    memo: "Weekly ZFS pool scrub + autotrim (zfspv-pool-nvme, zfspv-pool-hdd)",
  },
  {
    id: "bugsink-housekeeping",
    workflowType: "runBugsinkHousekeepingWorkflow",
    args: [],
    cronExpression: "0 3 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "30 minutes",
    memo: "Daily Bugsink database housekeeping (delete old events, vacuum)",
  },
  {
    id: "scout-image-gc-daily",
    workflowType: "runScoutImageGcWorkflow",
    args: [{ retentionDays: 30, dryRun: false }],
    // 04:00 PT — after the 03:00 bugsink/zfs maintenance window so the nightly
    // destructive jobs don't contend for the worker pod at once.
    cronExpression: "0 4 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // First run sweeps ~110k objects and deletes ~38k; steady-state runs finish
    // in <1m. This workflow-level cap must fit the activity's full retry budget,
    // not just one attempt: the retry policy allows 3 attempts at a 20m
    // startToCloseTimeout each (plus ~90s of backoff), so a 25m cap would let a
    // slow-but-failing first attempt consume the whole window and starve retries
    // 2 and 3. 65m genuinely accommodates 3 × 20m + backoff; SKIP overlap + the
    // daily cadence make the wider ceiling harmless (the next run is 24h out).
    workflowExecutionTimeout: "65 minutes",
    memo: "Daily GC of Scout images: delete .png/.svg older than 30d under games/ & prematch/ in scout-prod + scout-beta (SeaweedFS), keeping JSON. See packages/docs/plans/2026-07-03_scout-s3-image-retention.md",
  },
  {
    id: "velero-orphan-audit",
    workflowType: "runVeleroOrphanAuditWorkflow",
    args: [],
    // 03:30 PT — staggered after zfs-maintenance so the audit captures a
    // stable post-backup state.
    cronExpression: "30 3 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "15 minutes",
    memo: "Daily Velero orphan ZFS snapshot detection — emits Prometheus metrics for the orphan-snapshot pathology (see packages/docs/decisions/2026-05-05_velero-orphan-snapshot-prevention.md)",
  },
  {
    id: "golink-sync",
    workflowType: "syncGolinks",
    args: [],
    cronExpression: "0 5 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "4 minutes",
    memo: "Sync Tailscale ingresses to golink aliases (daily 5 AM PT)",
  },
  {
    id: "vacuum-9am",
    workflowType: "runVacuumIfNotHome",
    args: [],
    cronExpression: "0 9 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // verifyState worst case = 3m delay + 3×1m inter-attempt sleeps + slack
    workflowExecutionTimeout: "15 minutes",
    catchupWindow: CATCHUP_TIGHT,
    memo: "Run vacuum if no one is home (9 AM)",
  },
  {
    id: "vacuum-12pm",
    workflowType: "runVacuumIfNotHome",
    args: [],
    cronExpression: "0 12 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // verifyState worst case = 3m delay + 3×1m inter-attempt sleeps + slack
    workflowExecutionTimeout: "15 minutes",
    catchupWindow: CATCHUP_TIGHT,
    memo: "Run vacuum if no one is home (12 PM)",
  },
  {
    id: "vacuum-5pm",
    workflowType: "runVacuumIfNotHome",
    args: [],
    cronExpression: "0 17 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // verifyState worst case = 3m delay + 3×1m inter-attempt sleeps + slack
    workflowExecutionTimeout: "15 minutes",
    catchupWindow: CATCHUP_TIGHT,
    memo: "Run vacuum if no one is home (5 PM)",
  },
  {
    // Floor preheat 2h15m before wake: the bathroom floor ramps ~8.3°C/hour
    // (measured 2026-07-09), so reaching the 40°C setpoint from a ~22°C
    // overnight start needs ~2¼ hours. The workflow holds the setpoint for
    // 195m (13 × 15m presence-checked chunks) then turns off as its own
    // backstop; the timeout carries generous slack so worker delay or activity
    // retries can never time the run out before the turn-off executes.
    id: "good-morning-weekday-preheat",
    workflowType: "goodMorningPreheat",
    args: [],
    cronExpression: "45 5 * * 1-5",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "240 minutes",
    catchupWindow: CATCHUP_TIGHT,
    memo: "Bathroom floor preheat (weekdays 5:45 AM)",
  },
  {
    id: "good-morning-weekday-wake",
    workflowType: "goodMorningWakeUp",
    args: [],
    cronExpression: "0 8 * * 1-5",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // goodMorningWakeUp still runs its 60-minute heat window (MORNING_HEAT_DURATION)
    // as the fallback when the preheat run was skipped; needs > 60m + slack
    workflowExecutionTimeout: "75 minutes",
    catchupWindow: CATCHUP_TIGHT,
    memo: "Good morning wake-up + bathroom heat (weekdays 8 AM)",
  },
  {
    id: "good-morning-weekday-up",
    workflowType: "goodMorningGetUp",
    args: [],
    cronExpression: "15 8 * * 1-5",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "30 minutes",
    catchupWindow: CATCHUP_TIGHT,
    memo: "Good morning get-up (weekdays 8:15 AM)",
  },
  {
    // Weekend preheat: 2h15m before the 9 AM weekend wake.
    id: "good-morning-weekend-preheat",
    workflowType: "goodMorningPreheat",
    args: [],
    cronExpression: "45 6 * * 0,6",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "240 minutes",
    catchupWindow: CATCHUP_TIGHT,
    memo: "Bathroom floor preheat (weekends 6:45 AM)",
  },
  {
    id: "good-morning-weekend-wake",
    workflowType: "goodMorningWakeUp",
    args: [],
    cronExpression: "0 9 * * 0,6",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // goodMorningWakeUp still runs its 60-minute heat window (MORNING_HEAT_DURATION)
    // as the fallback when the preheat run was skipped; needs > 60m + slack
    workflowExecutionTimeout: "75 minutes",
    catchupWindow: CATCHUP_TIGHT,
    memo: "Good morning wake-up + bathroom heat (weekends 9 AM)",
  },
  {
    id: "good-morning-weekend-up",
    workflowType: "goodMorningGetUp",
    args: [],
    cronExpression: "15 9 * * 0,6",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "30 minutes",
    catchupWindow: CATCHUP_TIGHT,
    memo: "Good morning get-up (weekends 9:15 AM)",
  },
];

export function buildSchedulePolicies(schedule: ScheduleDefinition): {
  overlap: ScheduleOverlapPolicy;
  // CatchupWindow (not `Duration`): the resolved value is always one of the two
  // literal tiers, and `Duration` is error-typed under CI's Node16 `ms`
  // resolution. Both literals are valid Temporal Durations at the call site.
  catchupWindow: CatchupWindow;
} {
  return {
    overlap: schedule.overlap,
    catchupWindow: schedule.catchupWindow ?? CATCHUP_RELAXED,
  };
}

export async function registerSchedules(client: Client): Promise<void> {
  const scheduleClient = client.schedule;

  for (const scheduleId of DELETED_SCHEDULE_IDS) {
    try {
      await scheduleClient.getHandle(scheduleId).delete();
      console.warn(`Deleted orphaned schedule: ${scheduleId}`);
    } catch (error: unknown) {
      if (!(error instanceof ScheduleNotFoundError)) {
        throw error;
      }
    }
  }

  for (const schedule of SCHEDULES) {
    const handle = scheduleClient.getHandle(schedule.id);
    try {
      // Update the existing schedule
      await handle.update((prev) => ({
        ...prev,
        spec: {
          cronExpressions: [schedule.cronExpression],
          timezone: SCHEDULE_TIMEZONE,
        },
        action: {
          type: "startWorkflow",
          workflowType: schedule.workflowType,
          args: schedule.args,
          taskQueue: schedule.taskQueue,
          ...(schedule.workflowExecutionTimeout === undefined
            ? {}
            : { workflowExecutionTimeout: schedule.workflowExecutionTimeout }),
        },
        policies: buildSchedulePolicies(schedule),
      }));

      console.warn(`Updated schedule: ${schedule.id}`);
    } catch (error: unknown) {
      if (!(error instanceof ScheduleNotFoundError)) {
        throw error;
      }
      // Schedule doesn't exist yet — create it
      await scheduleClient.create({
        scheduleId: schedule.id,
        spec: {
          cronExpressions: [schedule.cronExpression],
          timezone: SCHEDULE_TIMEZONE,
        },
        action: {
          type: "startWorkflow",
          workflowType: schedule.workflowType,
          args: schedule.args,
          taskQueue: schedule.taskQueue,
          ...(schedule.workflowExecutionTimeout === undefined
            ? {}
            : { workflowExecutionTimeout: schedule.workflowExecutionTimeout }),
        },
        policies: buildSchedulePolicies(schedule),
        memo: { description: schedule.memo },
      });

      console.warn(`Created schedule: ${schedule.id}`);
    }
  }

  // After reconciling the declared set, surface any live schedule that is no
  // longer represented in source (renamed/removed but not added to the delete
  // list). Non-fatal — see detectOrphanSchedules.
  await detectOrphanSchedules(
    scheduleClient,
    new Set(SCHEDULES.map((schedule) => schedule.id)),
    new Set(DELETED_SCHEDULE_IDS),
  );
}
