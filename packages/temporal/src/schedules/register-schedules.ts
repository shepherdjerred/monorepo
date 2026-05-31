import type { Client } from "@temporalio/client";
import {
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
} from "@temporalio/client";
import type { Duration } from "@temporalio/common";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { EVAL_FIXTURES_PIN } from "#shared/pr-review/eval-fixture.ts";
import type { AgentTaskInput } from "#shared/agent-task.ts";

// All cron expressions below are wall-clock local time for the homelab.
const SCHEDULE_TIMEZONE = "America/Los_Angeles";

type ScheduleDefinition = {
  id: string;
  workflowType: string;
  args: unknown[];
  cronExpression: string;
  taskQueue: string;
  overlap: ScheduleOverlapPolicy;
  memo: string;
  workflowExecutionTimeout?: Duration;
};

const PR_REVIEW_EVAL_SCHEDULE_ID = "pr-review-eval-nightly";
const PR_REVIEW_FIXTURES_REPO_URL_ENV = "PR_REVIEW_FIXTURES_REPO_URL";
const PR_REVIEW_EVAL_PAUSE_REASON =
  "Paused because PR_REVIEW_FIXTURES_REPO_URL is not configured on the Temporal worker";

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
  maxTurns: 35,
  emailSubjectPrefix: "Homelab Audit",
  source: {
    docPath: "packages/docs/guides/2026-04-04_homelab-audit-runbook.md",
  },
  prompt: [
    "Run the daily homelab health audit using the runbook at",
    "`packages/docs/guides/2026-04-04_homelab-audit-runbook.md` in the checked-out repo.",
    "Use live read-only evidence from the cluster and observability tools named in the runbook.",
    "Do not mutate Kubernetes, GitHub, PagerDuty, Grafana, Bugsink, Cloudflare, files, or git state.",
    "Keep the run bounded: prioritize active incidents, firing alerts, failed Temporal workflows,",
    "and changed deltas over exhaustive historical sweeps. Avoid broad unbounded log queries.",
    "If a tool is slow or a section would exceed the useful audit window, skip that section,",
    "state exactly what was skipped, and return a partial report instead of continuing indefinitely.",
    "Return a concise markdown report suitable for email. Include current status, notable regressions,",
    "resolved items, remaining action items, and exact evidence links or commands where useful.",
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
    workflowExecutionTimeout: "2 hours",
    memo: "Daily homelab health audit email via generic report-only agent task (Claude -> Postal)",
  },
  {
    id: "alert-remediation-hourly",
    workflowType: "alertRemediationSweepWorkflow",
    args: [
      {
        repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
        provider: "claude",
        concurrency: 3,
      },
    ],
    cronExpression: "0 * * * *",
    taskQueue: TASK_QUEUES.AGENT_TASK,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "2 hours",
    memo: "Hourly PagerDuty/Bugsink alert remediation fan-out. Child workflows may create draft PRs for straightforward repo-only fixes.",
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
    id: "pr-review-ab-weekly-report",
    workflowType: "prReviewWeeklySignificanceWorkflow",
    args: [{}],
    // Monday 09:00 PT — the team is back from the weekend and can act
    // on a Discord report before standup. Workflow is cheap (single
    // Postgres query per experiment + 100k MC samples per arm), so we
    // don't bother staggering against the nightly cron.
    cronExpression: "0 9 * * 1",
    taskQueue: TASK_QUEUES.PR_REVIEW,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "10 minutes",
    memo: "Weekly pr-review-bot A/B significance report — Bayesian posterior over real-PR acceptance, Discord post Mon 09:00 PT",
  },
  {
    id: PR_REVIEW_EVAL_SCHEDULE_ID,
    workflowType: "prReviewEvalWorkflow",
    args: [{ pin: EVAL_FIXTURES_PIN }],
    // 04:00 PT — staggered after velero-orphan-audit (03:30) so the
    // worker pod isn't fighting two cron workflows for resources. The
    // eval workflow takes ~10-20 min depending on corpus size + LLM
    // latency; an hour of headroom before any 5am workflows is fine.
    cronExpression: "0 4 * * *",
    taskQueue: TASK_QUEUES.PR_REVIEW,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "2 hours",
    memo: "Nightly pr-review-bot continuous-eval — replay against fixture corpus, persist precision/recall to pr_review_eval Postgres, fire PD alert on > 5pp drop vs trailing-7d mean",
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
    memo: "Run vacuum if no one is home (5 PM)",
  },
  {
    id: "good-morning-weekday-wake",
    workflowType: "goodMorningWakeUp",
    args: [],
    cronExpression: "0 8 * * 1-5",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // goodMorningWakeUp now runs the 60-minute heat cycle (MORNING_HEAT_DURATION); needs > 60m + slack
    workflowExecutionTimeout: "75 minutes",
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
    memo: "Good morning get-up (weekdays 8:15 AM)",
  },
  {
    id: "good-morning-weekend-wake",
    workflowType: "goodMorningWakeUp",
    args: [],
    cronExpression: "0 9 * * 0,6",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // goodMorningWakeUp now runs the 60-minute heat cycle (MORNING_HEAT_DURATION); needs > 60m + slack
    workflowExecutionTimeout: "75 minutes",
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
    memo: "Good morning get-up (weekends 9:15 AM)",
  },
];

export function prReviewEvalFixturesConfigured(
  env: Record<string, string | undefined> = Bun.env,
): boolean {
  return (env[PR_REVIEW_FIXTURES_REPO_URL_ENV]?.trim() ?? "").length > 0;
}

export function scheduleRequiresConfigPause(
  schedule: ScheduleDefinition,
  env: Record<string, string | undefined> = Bun.env,
): { paused: boolean; reason: string | undefined } {
  if (schedule.id !== PR_REVIEW_EVAL_SCHEDULE_ID) {
    return { paused: false, reason: undefined };
  }
  if (prReviewEvalFixturesConfigured(env)) {
    return { paused: false, reason: undefined };
  }
  return { paused: true, reason: PR_REVIEW_EVAL_PAUSE_REASON };
}

async function reconcileSchedulePauseState(
  handle: ReturnType<Client["schedule"]["getHandle"]>,
  schedule: ScheduleDefinition,
): Promise<void> {
  const desired = scheduleRequiresConfigPause(schedule);
  if (desired.paused) {
    await handle.pause(desired.reason ?? "Paused by schedule configuration");
    console.warn(`Paused schedule: ${schedule.id} (${desired.reason ?? ""})`);
    return;
  }
  if (schedule.id === PR_REVIEW_EVAL_SCHEDULE_ID) {
    await handle.unpause(
      `${PR_REVIEW_FIXTURES_REPO_URL_ENV} is configured; eval schedule enabled`,
    );
    console.warn(`Unpaused schedule: ${schedule.id}`);
  }
}

export async function registerSchedules(client: Client): Promise<void> {
  const scheduleClient = client.schedule;

  for (const schedule of SCHEDULES) {
    let handle = scheduleClient.getHandle(schedule.id);
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
        policies: {
          overlap: schedule.overlap,
        },
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
        policies: {
          overlap: schedule.overlap,
        },
        memo: { description: schedule.memo },
      });

      console.warn(`Created schedule: ${schedule.id}`);
      handle = scheduleClient.getHandle(schedule.id);
    }
    await reconcileSchedulePauseState(handle, schedule);
  }
}
