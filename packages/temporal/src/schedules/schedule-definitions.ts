import { ScheduleOverlapPolicy } from "@temporalio/client";
import type { Duration } from "@temporalio/common";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { GLITTER_CORPUS_STORAGE_ENV } from "./glitter-schedule-environment.ts";
import {
  HOMELAB_AUDIT_AGENT_TASK,
  SCOUT_LANE_PRIOR_UPDATE_CONFIG,
} from "./schedule-payloads.ts";

// Split out of register-schedules.ts (which sits at the repo's max-lines
// cap) — the declarative SCHEDULES array plus its supporting types/data, no
// registration logic. Import SCHEDULES from #schedules/schedule-definitions.ts
// directly (register-schedules.ts does not re-export it — custom-rules/no-re-exports).

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
export const CATCHUP_TIGHT = "5 minutes";
export const CATCHUP_RELAXED = "1 hour";

// The two declared catchup tiers as a literal union (not `Duration`), so reading
// the optional schedule field in buildSchedulePolicies can never yield an
// error-typed value. Both literals are valid Temporal `Duration`s at the policies
// call site.
export type CatchupWindow = typeof CATCHUP_TIGHT | typeof CATCHUP_RELAXED;

export type ScheduleDefinition = {
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
  requiredEnvironment?: readonly string[];
  requiredPresentEnvironment?: readonly string[];
  initialPauseNote?: string;
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
    id: "kometa-daily",
    workflowType: "runKometaWorkflow",
    args: [],
    cronExpression: "30 4 * * *",
    taskQueue: TASK_QUEUES.MAINTENANCE,
    overlap: ScheduleOverlapPolicy.SKIP,
    // Three 30-minute attempts plus exponential backoff and workflow overhead.
    workflowExecutionTimeout: "2 hours",
    memo: "Daily Kometa Plex metadata and collection synchronization",
  },
  {
    id: "scout-data-dragon-version-check",
    workflowType: "runScoutDataDragonVersionCheck",
    args: [SCOUT_LANE_PRIOR_UPDATE_CONFIG],
    cronExpression: "0 6 * * 0-5",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // Must exceed updateDataDragon's full retry budget so the final attempt's
    // catch always records the outcome="failed" metric before the workflow is
    // terminated. Budget: 2 attempts × 90m startToClose + 5m retry gap + the
    // getState precheck ≈ 194m; a shorter timeout could terminate attempt 2
    // mid-run outside the catch, dropping the failure sample the alert needs.
    workflowExecutionTimeout: "4 hours",
    memo: "Check LoL Data Dragon version and update Scout assets when needed",
  },
  {
    id: "scout-data-dragon-weekly-refresh",
    workflowType: "runScoutDataDragonWeeklyRefresh",
    args: [SCOUT_LANE_PRIOR_UPDATE_CONFIG],
    cronExpression: "0 6 * * 6",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // See scout-data-dragon-version-check above: sized to exceed
    // updateDataDragon's full ~194m retry budget so a terminal failure is
    // always recorded before the workflow times out.
    workflowExecutionTimeout: "4 hours",
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
    id: "scout-showcase-refresh-weekly",
    workflowType: "runScoutShowcaseRefresh",
    args: [],
    // Mon 10:00 PT — continues the weekly PR-job stagger (07/08/09). A
    // NoSuchKey failure means a manifest-referenced S3 object vanished
    // despite the scout-image-gc showcase exemption — re-curate the manifest
    // (scout AGENTS.md runbook) rather than retrying.
    cronExpression: "0 10 * * 1",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "60 minutes",
    memo: "Weekly marketing-showcase refresh — regenerates the committed showcase PNGs + asset index from scout-prod, opens a PR on drift (generatedAt-only churn suppressed)",
  },
  {
    id: "scout-queue-windows-daily",
    workflowType: "runScoutQueueWindowsWatch",
    args: [],
    // 06:45 PT — staggered after the 06:00 data-dragon version check. Scans
    // the scout-prod match lake (21-day lookback) for limited-queue window
    // drift; opens an auto-merging PR for window opens/reopens, a plain PR
    // for closes (a human confirms against patch notes), and emails
    // warnings-only runs. Steady state is a silent no-diff.
    cronExpression: "45 6 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // 65 min: the 30-min startToCloseTimeout plus the 2-min retry backoff plus a
    // second full 30-min attempt is 62 min; 45 min would terminate the retry
    // (only 13 min left after the first attempt + backoff), so give the
    // configured maximumAttempts=2 room to actually run the serial 21-day scan.
    workflowExecutionTimeout: "65 minutes",
    memo: "Daily LoL limited-queue window watcher — proposes queue-windows.json edits from scout-prod match volume; auto-merge on open/reopen, plain PR on close",
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
    id: "buildkite-uv-cache-prune-weekly",
    workflowType: "runUvCachePruneWorkflow",
    args: [],
    cronExpression: "15 3 * * 0",
    taskQueue: TASK_QUEUES.MAINTENANCE,
    overlap: ScheduleOverlapPolicy.SKIP,
    // Three 30-minute attempts plus exponential backoff and workflow overhead.
    workflowExecutionTimeout: "2 hours",
    memo: "Weekly Buildkite uv cache prune on the CI node",
  },
  {
    id: "buildkite-trivy-db-refresh",
    workflowType: "runTrivyDbRefreshWorkflow",
    args: [],
    cronExpression: "30 */6 * * *",
    taskQueue: TASK_QUEUES.MAINTENANCE,
    overlap: ScheduleOverlapPolicy.SKIP,
    // Three 30-minute attempts plus exponential backoff and workflow overhead.
    workflowExecutionTimeout: "2 hours",
    memo: "Buildkite Trivy vulnerability database refresh every six hours",
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
    id: "glitter-corpus-daily",
    workflowType: "runGlitterCorpusDaily",
    args: [],
    // 04:15 PT — after the maintenance window starts and before the other
    // data-refresh jobs. The dedicated queue enforces one Discord request at
    // a time regardless of other Temporal activity traffic.
    cronExpression: "15 4 * * *",
    taskQueue: TASK_QUEUES.GLITTER_CORPUS,
    overlap: ScheduleOverlapPolicy.SKIP,
    workflowExecutionTimeout: "6 hours",
    memo: "Daily Discord REST capture with seven-day overlap and a full historical refresh after six overlaps",
    initialPauseNote: "Awaiting operator approval of first complete snapshot",
    requiredEnvironment: [
      "GLITTER_DISCORD_TOKEN",
      "GLITTER_DISCORD_GUILD_ID",
      "GLITTER_DISCORD_GUILD_SLUG",
      ...GLITTER_CORPUS_STORAGE_ENV,
    ],
    requiredPresentEnvironment: ["GLITTER_DISCORD_DENYLIST_CHANNEL_IDS"],
  },
  {
    id: "glitter-context-refresh-weekly",
    workflowType: "runGlitterContextRefresh",
    args: [{ maxEstimatedCostUsd: 10 }],
    // Monday 11:00 PT, isolated from Discord capture and after other PR jobs.
    cronExpression: "0 11 * * 1",
    taskQueue: TASK_QUEUES.GLITTER_CONTEXT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // The activity allows two complete 7h attempts separated by a 2m
    // backoff. Keep the workflow deadline above that 14h2m retry envelope so
    // a late first-attempt failure does not strand the paid run.
    workflowExecutionTimeout: "15 hours",
    memo: "Weekly GPT-5.6 Luna extraction and Sol synthesis of shared Glitter style cards plus evidence-backed relationship history from the verified corpus",
    initialPauseNote:
      "Awaiting credentialed dry-run against the first approved complete snapshot",
    requiredEnvironment: [
      "GLITTER_DISCORD_GUILD_ID",
      ...GLITTER_CORPUS_STORAGE_ENV,
      "OPENAI_API_KEY",
      "GITHUB_APP_ID",
      "GITHUB_APP_INSTALLATION_ID",
      "GITHUB_APP_PRIVATE_KEY",
    ],
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
    id: "review-signals-collect",
    workflowType: "observeReviewSignalsWorkflow",
    args: [],
    // Every 6 hours — frequent enough to catch same-day review latency
    // patterns without hammering the GitHub API on every recent PR.
    cronExpression: "0 */6 * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // Must fit the activity's FULL retry budget, not one attempt: the
    // `runObserveReviewSignals` proxy allows 3 attempts at a 5m
    // startToCloseTimeout each (observe-review-signals workflow) plus ~30s of
    // 10s/20s backoff = ~15m30s. A 10m cap terminated the workflow mid-2nd
    // attempt and made attempt 3 unreachable; 18m covers 3×5m + backoff + slack.
    // SKIP overlap + the 6-hourly cadence make the wider ceiling harmless.
    workflowExecutionTimeout: "18 minutes",
    memo: "Durable review-signal collector — scans recent PRs, computes each PR's code-review signal via @shepherdjerred/code-review, records Prometheus metrics, and appends NDJSON to S3 (what the review bot did and when)",
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
  {
    id: "temporal-failure-watch",
    workflowType: "pollWorkflowFailuresWorkflow",
    args: [],
    // Every 5 minutes. The activity looks back 24 hours so a worker outage can
    // be recovered by the next poll; the matching alert TTL prevents duplicate
    // pages for executions observed again after recovery.
    cronExpression: "*/5 * * * *",
    taskQueue: TASK_QUEUES.DEFAULT,
    overlap: ScheduleOverlapPolicy.SKIP,
    // Covers the activity's full 3-attempt retry budget (3x 2m + ~30s
    // backoff ≈ 6.5m) with margin; SKIP overlap makes the wider ceiling
    // harmless against the 5-minute cadence.
    workflowExecutionTimeout: "8 minutes",
    memo: "Pages PagerDuty (via Alertmanager) with the specific error for every Temporal workflow execution that failed or timed out — see packages/docs/plans/2026-07-30_temporal-workflow-failure-pagerduty-alerts.md",
  },
];
