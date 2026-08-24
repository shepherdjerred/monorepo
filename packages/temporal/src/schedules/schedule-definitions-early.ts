import { ScheduleOverlapPolicy } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { ScheduleDefinition } from "./schedule-definitions.ts";

export const EARLY_SCHEDULES: ScheduleDefinition[] = [
  {
    id: "report-freshness-monitor",
    workflowType: "monitorReportFreshness",
    args: [],
    cronExpression: "*/15 * * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "20 minutes",
    memo: "Every-15-minute accepted report heartbeat freshness monitor",
  },
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
    id: "freshrss-sync-hourly",
    workflowType: "runFreshRssSyncWorkflow",
    args: [],
    cronExpression: "7 * * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    catchupWindow: "5 minutes",
    workflowExecutionTimeout: "6 minutes",
    memo: "Hourly FreshRSS Repo Stack reconciliation before feed refresh",
  },
  {
    id: "buildkite-bun-cache-gc",
    workflowType: "runBunCacheGcWorkflow",
    args: [],
    cronExpression: "*/5 * * * *",
    taskQueue: TASK_QUEUES.MAINTENANCE,
    overlap: ScheduleOverlapPolicy.SKIP,
    // Three 15-minute attempts plus exponential backoff and workflow overhead.
    workflowExecutionTimeout: "1 hour",
    memo: "Every-five-minute Buildkite Bun cache GC on the CI node",
  },
  {
    id: "turbo-cache-clean-daily",
    workflowType: "runTurboCacheCleanWorkflow",
    args: [],
    cronExpression: "30 2 * * *",
    taskQueue: TASK_QUEUES.MAINTENANCE,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "30 minutes",
    memo: "Daily deletion of monorepo Turbo cache artifacts unused for 30 days",
  },
  {
    id: "deps-summary-weekly",
    workflowType: "generateDependencySummary",
    args: [7],
    cronExpression: "0 9 * * 1",
    taskQueue: TASK_QUEUES.DEFAULT,
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
    cronExpression: "0 9 * * 1",
    taskQueue: TASK_QUEUES.DEFAULT,
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
    cronExpression: "0 9 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "20 minutes",
    memo: "Daily typed TaskNotes engine, pod, skipped-file, and accepted task-count baseline check",
  },
  {
    id: "ci-io-post-merge-impact",
    workflowType: "runCiIoImpact",
    args: [],
    cronExpression: "0 9 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "2 hours",
    memo: "Daily deterministic schema-v4 CI I/O impact and observability report",
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
    id: "homelab-crd-imports-daily",
    workflowType: "runHomelabCrdImportsRefresh",
    args: [],
    // 05:30 PT — between fetcher/golink (05:00) and dns-audit (06:00). CRD
    // drift is time-coupled (operator chart bumps ArgoCD-synced after
    // Renovate merges land), so only a schedule can see it — no CI gate runs
    // when the cluster changes.
    cronExpression: "30 5 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
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
    cronExpression: "30 4 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
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
    cronExpression: "30 6 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "50 minutes",
    memo: "Deterministic daily homelab health check with evidence-backed report delivery",
  },
];
