// Temporal requires workflows to be exported from a single entry point.
// These wrapper functions delegate to the actual workflow implementations
// to satisfy the no-re-exports lint rule.
import { fetchSkillCappedManifest as _fetchSkillCappedManifest } from "./fetcher.ts";
import { generateDependencySummary as _generateDependencySummary } from "./deps-summary.ts";
import { runDnsAudit as _runDnsAudit } from "./dns-audit.ts";
import { syncGolinks as _syncGolinks } from "./golink-sync.ts";
import {
  goodMorningEarly as _goodMorningEarly,
  goodMorningGetUp as _goodMorningGetUp,
  goodMorningWakeUp as _goodMorningWakeUp,
} from "./ha/good-morning.ts";
import { goodNight as _goodNight } from "./ha/good-night.ts";
import { welcomeHome as _welcomeHome } from "./ha/welcome-home.ts";
import { leavingHome as _leavingHome } from "./ha/leaving-home.ts";
import { runVacuumIfNotHome as _runVacuumIfNotHome } from "./ha/run-vacuum-if-not-home.ts";
import { runZfsMaintenanceWorkflow as _runZfsMaintenanceWorkflow } from "./zfs-maintenance.ts";
import { runBugsinkHousekeepingWorkflow as _runBugsinkHousekeepingWorkflow } from "./bugsink.ts";
import { runVeleroOrphanAuditWorkflow as _runVeleroOrphanAuditWorkflow } from "./velero-orphan-audit.ts";
import { runScoutDataDragonUpdate as _runScoutDataDragonUpdate } from "./data-dragon.ts";
import type { DataDragonUpdateResult } from "#activities/data-dragon.ts";
import { runScoutSeasonRefreshWorkflow as _runScoutSeasonRefreshWorkflow } from "./scout-season-refresh.ts";
import type {
  ScoutSeasonRefreshInput,
  ScoutSeasonRefreshResult,
} from "#activities/scout-season-refresh.ts";
import { prReview as _prReview } from "./pr-review.ts";
import {
  prSummary as _prSummary,
  prSummaryPipeline as _prSummaryPipeline,
} from "./pr-summary/index.ts";
import { prReviewPipeline as _prReviewPipeline } from "./pr-review/index.ts";
import { prReviewEvalWorkflow as _prReviewEvalWorkflow } from "./pr-review-eval/index.ts";
import type {
  PrReviewEvalWorkflowInput,
  PrReviewEvalWorkflowResult,
} from "./pr-review-eval/index.ts";
import { prReviewWeeklySignificanceWorkflow as _prReviewWeeklySignificanceWorkflow } from "./pr-review-eval/weekly-significance.ts";
import type {
  WeeklySignificanceWorkflowInput,
  WeeklySignificanceWorkflowResult,
} from "./pr-review-eval/weekly-significance.ts";
import {
  prReactionListener as _prReactionListener,
  type PrReactionListenerInput,
} from "./pr-reaction-listener/index.ts";
import { runHomelabAuditWorkflow as _runHomelabAuditWorkflow } from "./homelab-audit.ts";
import type { RunHomelabAuditWorkflowInput } from "./homelab-audit.ts";
import type {
  PrAgentInput,
  PrReviewPipelineInput,
  PrSummaryInput,
} from "#shared/schemas.ts";
import type { PrAgentResult } from "#activities/pr-agent.ts";
import type { PrReviewPipelineResult } from "./pr-review/index.ts";
import type { RunSummaryResult } from "#activities/pr-review/summary.ts";

export async function fetchSkillCappedManifest(): Promise<void> {
  return _fetchSkillCappedManifest();
}

export async function generateDependencySummary(daysBack = 7): Promise<void> {
  return _generateDependencySummary(daysBack);
}

export async function runDnsAudit(): Promise<void> {
  return _runDnsAudit();
}

export async function syncGolinks(): Promise<void> {
  return _syncGolinks();
}

export async function goodMorningEarly(): Promise<void> {
  return _goodMorningEarly();
}

export async function goodMorningWakeUp(): Promise<void> {
  return _goodMorningWakeUp();
}

export async function goodMorningGetUp(): Promise<void> {
  return _goodMorningGetUp();
}

export async function goodNight(): Promise<void> {
  return _goodNight();
}

export async function welcomeHome(): Promise<void> {
  return _welcomeHome();
}

export async function leavingHome(): Promise<void> {
  return _leavingHome();
}

export async function runVacuumIfNotHome(): Promise<void> {
  return _runVacuumIfNotHome();
}

export async function runZfsMaintenanceWorkflow(): Promise<void> {
  return _runZfsMaintenanceWorkflow();
}

export async function runBugsinkHousekeepingWorkflow(): Promise<void> {
  return _runBugsinkHousekeepingWorkflow();
}

export async function runVeleroOrphanAuditWorkflow(): Promise<void> {
  return _runVeleroOrphanAuditWorkflow();
}

export async function runScoutDataDragonVersionCheck(): Promise<
  DataDragonUpdateResult | undefined
> {
  return _runScoutDataDragonUpdate("version-check");
}

export async function runScoutDataDragonWeeklyRefresh(): Promise<
  DataDragonUpdateResult | undefined
> {
  return _runScoutDataDragonUpdate("weekly-refresh");
}

export async function runScoutSeasonRefreshWorkflow(
  input: ScoutSeasonRefreshInput = {},
): Promise<ScoutSeasonRefreshResult> {
  return _runScoutSeasonRefreshWorkflow(input);
}

export async function prReview(input: PrAgentInput): Promise<PrAgentResult> {
  return _prReview(input);
}

export async function prSummary(input: PrAgentInput): Promise<PrAgentResult> {
  return _prSummary(input);
}

export async function prReviewPipeline(
  input: PrReviewPipelineInput,
): Promise<PrReviewPipelineResult> {
  return _prReviewPipeline(input);
}

export async function prSummaryPipeline(
  input: PrSummaryInput,
): Promise<RunSummaryResult> {
  return _prSummaryPipeline(input);
}

export async function runHomelabAuditWorkflow(
  input: RunHomelabAuditWorkflowInput = {},
): Promise<void> {
  return _runHomelabAuditWorkflow(input);
}

export async function prReviewEvalWorkflow(
  input: PrReviewEvalWorkflowInput,
): Promise<PrReviewEvalWorkflowResult> {
  return _prReviewEvalWorkflow(input);
}

export async function prReviewWeeklySignificanceWorkflow(
  input: WeeklySignificanceWorkflowInput = {},
): Promise<WeeklySignificanceWorkflowResult> {
  return _prReviewWeeklySignificanceWorkflow(input);
}

export async function prReactionListener(
  input: PrReactionListenerInput,
): Promise<void> {
  return _prReactionListener(input);
}
