import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { schedulesInNamespace } from "./schedule-types.ts";

export const EARLY_SCHEDULES = schedulesInNamespace("prod", [
  {
    id: "report-freshness-monitor",
    workflowType: "monitorReportFreshness",
    args: [],
    timing: {
      kind: "cron",
      expression: "*/15 * * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "20 minutes",
    memo: "Every-15-minute accepted report heartbeat freshness monitor",
  },
  {
    id: "fetcher-skill-capped",
    workflowType: "fetchSkillCappedManifest",
    args: [],
    timing: {
      kind: "cron",
      expression: "0 5 * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "5 minutes",
    memo: "Fetch Better Skill Capped manifest from Firestore and upload to S3 (daily at 05:00 PT)",
  },
  {
    id: "freshrss-sync-hourly",
    workflowType: "runFreshRssSyncWorkflow",
    args: [],
    timing: {
      kind: "cron",
      expression: "7 * * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: "5 minutes",
    workflowExecutionTimeout: "6 minutes",
    memo: "Hourly FreshRSS Repo Stack reconciliation before feed refresh",
  },
  {
    id: "flipt-flag-inventory-daily",
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
    memo: "Daily Flipt managed-flag inventory drift check with Alertmanager fire/resolve",
  },
  {
    id: "buildkite-bun-cache-gc",
    workflowType: "runBunCacheGcWorkflow",
    args: [],
    timing: {
      kind: "cron",
      expression: "*/5 * * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    // Three 15-minute attempts plus exponential backoff and workflow overhead.
    workflowExecutionTimeout: "1 hour",
    memo: "Every-five-minute Buildkite Bun cache GC on the CI node",
  },
  {
    id: "turbo-cache-clean-daily",
    workflowType: "runTurboCacheCleanWorkflow",
    args: [],
    timing: {
      kind: "cron",
      expression: "30 2 * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "30 minutes",
    memo: "Daily deletion of monorepo Turbo cache artifacts unused for 14 days",
  },
  {
    id: "deps-summary-weekly",
    workflowType: "generateDependencySummary",
    args: [7],
    timing: {
      kind: "cron",
      expression: "0 9 * * 1",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    // Three sequential 10-minute activities can each use three attempts;
    // delivery and checkpoint persistence also retry. Keep enough headroom for
    // the complete retry budget so a valid report is not killed before receipt.
    workflowExecutionTimeout: "3 hours",
    memo: "Weekly dependency summary email",
  },
  {
    id: "protobufjs-v8-watch-weekly",
    workflowType: "runProtobufWatch",
    args: [],
    timing: {
      kind: "cron",
      expression: "0 9 * * 1",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    // Worst case: three 1m collection attempts, three 2m primary-delivery
    // attempts, then three 2m failure-delivery attempts, plus retry delays and
    // workflow-task overhead. Keep ten minutes of headroom over the 15m
    // start-to-close total so the failure heartbeat can still be accepted.
    workflowExecutionTimeout: "25 minutes",
    memo: "Weekly typed npm metadata check for Temporal protobufjs v8 compatibility",
  },
  {
    id: "tasknotes-skipped-files-canary",
    workflowType: "runTasknotesCanary",
    args: [],
    timing: {
      kind: "cron",
      expression: "0 9 * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "20 minutes",
    memo: "Daily typed TaskNotes engine, pod, skipped-file, and accepted task-count baseline check",
  },
  {
    id: "ci-io-post-merge-impact",
    workflowType: "runCiIoImpact",
    args: [],
    timing: {
      kind: "cron",
      expression: "0 9 * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "2 hours",
    memo: "Daily deterministic schema-v4 CI I/O impact and observability report",
  },
  {
    id: "dns-audit-daily",
    workflowType: "runDnsAudit",
    args: [],
    timing: {
      kind: "cron",
      expression: "0 6 * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "5 minutes",
    memo: "Daily DNS record audit (SPF, DMARC, MX)",
  },
  {
    id: "homelab-crd-imports-daily",
    workflowType: "runHomelabCrdImportsRefresh",
    args: [],
    // 05:30 PT — between fetcher/golink (05:00) and dns-audit (06:00). CRD
    // drift is time-coupled (operator chart bumps ArgoCD-synced after
    // Renovate merges land), so only a schedule can see it — no CI gate runs
    // when the cluster changes.
    timing: {
      kind: "cron",
      expression: "30 5 * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "45 minutes",
    memo: "Daily cdk8s CRD-import refresh — regenerates generated/imports from the live cluster CRDs and opens a PR on drift",
  },
  {
    id: "dpp-pokeemerald-data-daily",
    workflowType: "runPokeemeraldDataRefresh",
    args: [],
    // 04:30 PT — between scout-image-gc (04:00) and fetcher/golink (05:00).
    // Steady state is no-diff; the job opens a regen PR after a pinned
    // pokeemerald or knowledge source advances (hosted Renovate cannot run
    // the generators inside its own PR).
    timing: {
      kind: "cron",
      expression: "30 4 * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "30 minutes",
    memo: "Daily pokeemerald data refresh — regenerates committed species/map tables and the pinned knowledge corpus, opens a PR on drift",
  },
  {
    id: "homelab-audit-daily",
    workflowType: "runHomelabAuditWorkflow",
    args: [{}],
    // 06:30 PT — staggered after dns-audit-daily (06:00). Lands in inbox
    // before goodMorningEarly (07:00 weekdays / 08:00 weekends) fires.
    timing: {
      kind: "cron",
      expression: "30 6 * * *",
      timezone: "America/Los_Angeles",
    },
    taskQueue: TASK_QUEUES.WORKFLOWS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "50 minutes",
    memo: "Deterministic daily homelab health check with evidence-backed report delivery",
  },
]);
