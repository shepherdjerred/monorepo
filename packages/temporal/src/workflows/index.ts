// Temporal requires workflows to be exported from a single entry point.
// These wrapper functions delegate to the actual workflow implementations
// to satisfy the no-re-exports lint rule.
import { fetchSkillCappedManifest as _fetchSkillCappedManifest } from "./fetcher.ts";
import { generateDependencySummary as _generateDependencySummary } from "./deps-summary.ts";
import { runDnsAudit as _runDnsAudit } from "./dns-audit.ts";
import { syncGolinks as _syncGolinks } from "./golink-sync.ts";
import {
  goodMorningGetUp as _goodMorningGetUp,
  goodMorningPreheat as _goodMorningPreheat,
  goodMorningWakeUp as _goodMorningWakeUp,
} from "./ha/good-morning.ts";
import { goodNight as _goodNight } from "./ha/good-night.ts";
import { welcomeHome as _welcomeHome } from "./ha/welcome-home.ts";
import { leavingHome as _leavingHome } from "./ha/leaving-home.ts";
import { reconcileLock as _reconcileLock } from "./ha/reconcile-lock.ts";
import { runVacuumIfNotHome as _runVacuumIfNotHome } from "./ha/run-vacuum-if-not-home.ts";
import { runZfsMaintenanceWorkflow as _runZfsMaintenanceWorkflow } from "./zfs-maintenance.ts";
import { runBugsinkHousekeepingWorkflow as _runBugsinkHousekeepingWorkflow } from "./bugsink.ts";
import { runScoutImageGcWorkflow as _runScoutImageGcWorkflow } from "./scout-image-gc.ts";
import type {
  ScoutImageGcInput,
  ScoutImageGcResult,
} from "#activities/scout-image-gc.ts";
import { runVeleroOrphanAuditWorkflow as _runVeleroOrphanAuditWorkflow } from "./velero-orphan-audit.ts";
import { runScoutDataDragonUpdate as _runScoutDataDragonUpdate } from "./data-dragon.ts";
import type {
  DataDragonUpdateResult,
  DataDragonWorkflowInput,
} from "#activities/data-dragon.ts";
import { runReadmeRefresh as _runReadmeRefresh } from "./readme-refresh.ts";
import type { ReadmeRefreshResult } from "#activities/readme-refresh.ts";
import { runLlmCatalogRefresh as _runLlmCatalogRefresh } from "./llm-catalog-refresh.ts";
import type { LlmCatalogRefreshResult } from "#activities/llm-catalog-refresh.ts";
import { runHomelabCrdImportsRefresh as _runHomelabCrdImportsRefresh } from "./homelab-crd-imports-refresh.ts";
import type { HomelabCrdImportsRefreshResult } from "#activities/homelab-crd-imports-refresh.ts";
import { runPokeemeraldDataRefresh as _runPokeemeraldDataRefresh } from "./dpp-pokeemerald-data-refresh.ts";
import type { PokeemeraldDataRefreshResult } from "#activities/dpp-pokeemerald-data-refresh.ts";
import { runScoutShowcaseRefresh as _runScoutShowcaseRefresh } from "./scout-showcase-refresh.ts";
import type { ScoutShowcaseRefreshResult } from "#activities/scout-showcase-refresh.ts";
import { runScoutSeasonRefreshWorkflow as _runScoutSeasonRefreshWorkflow } from "./scout-season-refresh.ts";
import type {
  ScoutSeasonRefreshInput,
  ScoutSeasonRefreshResult,
} from "#activities/scout-season-refresh.ts";
import { prSummaryPipeline as _prSummaryPipeline } from "./pr-summary/index.ts";
import { prReviewPipeline as _prReviewPipeline } from "./pr-review/index.ts";
import {
  prReactionListener as _prReactionListener,
  type PrReactionListenerInput,
} from "./pr-reaction-listener/index.ts";
import { runHomelabAuditWorkflow as _runHomelabAuditWorkflow } from "./homelab-audit.ts";
import type { RunHomelabAuditWorkflowInput } from "./homelab-audit.ts";
import { agentTaskWorkflow as _agentTaskWorkflow } from "./agent-task.ts";
import { cancelBuildkiteBuildsWorkflow as _cancelBuildkiteBuildsWorkflow } from "./cancel-buildkite-builds.ts";
import { checkPrMergeConflictsWorkflow as _checkPrMergeConflictsWorkflow } from "./check-pr-merge-conflicts.ts";
import { prBabysitWorkflow as _prBabysitWorkflow } from "./pr-babysit/index.ts";
import type { PrBabysitWorkflowInput } from "#shared/pr-babysit/workflow-types.ts";
import type {
  CancelBuildkiteBuildsInput,
  CheckPrMergeConflictsInput,
  PrReviewPipelineInput,
  PrSummaryInput,
} from "#shared/schemas.ts";
import type { PrReviewPipelineResult } from "./pr-review/index.ts";
import type { RunSummaryResult } from "#activities/pr-review/summary.ts";
import type { AgentTaskInput } from "#shared/agent-task.ts";

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

export async function goodMorningPreheat(): Promise<void> {
  return _goodMorningPreheat();
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

export async function welcomeHome(firstArrival = true): Promise<void> {
  return _welcomeHome(firstArrival);
}

export async function leavingHome(): Promise<void> {
  return _leavingHome();
}

export async function reconcileLock(): Promise<void> {
  return _reconcileLock();
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

export async function runScoutImageGcWorkflow(
  input: ScoutImageGcInput = {},
): Promise<ScoutImageGcResult> {
  return _runScoutImageGcWorkflow(input);
}

export async function runVeleroOrphanAuditWorkflow(): Promise<void> {
  return _runVeleroOrphanAuditWorkflow();
}

export async function runScoutDataDragonVersionCheck(
  input: DataDragonWorkflowInput,
): Promise<DataDragonUpdateResult | undefined> {
  return _runScoutDataDragonUpdate("version-check", input);
}

export async function runScoutDataDragonWeeklyRefresh(
  input: DataDragonWorkflowInput,
): Promise<DataDragonUpdateResult | undefined> {
  return _runScoutDataDragonUpdate("weekly-refresh", input);
}

export async function runReadmeRefresh(): Promise<ReadmeRefreshResult> {
  return _runReadmeRefresh();
}

export async function runLlmCatalogRefresh(): Promise<LlmCatalogRefreshResult> {
  return _runLlmCatalogRefresh();
}

export async function runHomelabCrdImportsRefresh(): Promise<HomelabCrdImportsRefreshResult> {
  return _runHomelabCrdImportsRefresh();
}

export async function runPokeemeraldDataRefresh(): Promise<PokeemeraldDataRefreshResult> {
  return _runPokeemeraldDataRefresh();
}

export async function runScoutShowcaseRefresh(): Promise<ScoutShowcaseRefreshResult> {
  return _runScoutShowcaseRefresh();
}

export async function runScoutSeasonRefreshWorkflow(
  input: ScoutSeasonRefreshInput = {},
): Promise<ScoutSeasonRefreshResult> {
  return _runScoutSeasonRefreshWorkflow(input);
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

export async function agentTaskWorkflow(input: AgentTaskInput): Promise<void> {
  return _agentTaskWorkflow(input);
}

export async function prReactionListener(
  input: PrReactionListenerInput,
): Promise<void> {
  return _prReactionListener(input);
}

export async function cancelBuildkiteBuildsWorkflow(
  input: CancelBuildkiteBuildsInput,
): Promise<void> {
  return _cancelBuildkiteBuildsWorkflow(input);
}

export async function checkPrMergeConflictsWorkflow(
  input: CheckPrMergeConflictsInput,
): Promise<void> {
  return _checkPrMergeConflictsWorkflow(input);
}

export async function prBabysitWorkflow(
  input: PrBabysitWorkflowInput,
): Promise<void> {
  return _prBabysitWorkflow(input);
}
