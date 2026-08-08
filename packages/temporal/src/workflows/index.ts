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
import { runScoutQueueWindowsWatch as _runScoutQueueWindowsWatch } from "./scout-queue-windows.ts";
import type { ScoutQueueWindowsResult } from "#activities/scout-queue-windows.ts";
import type { ScoutShowcaseRefreshResult } from "#activities/scout-showcase-refresh.ts";
import { runScoutSeasonRefreshWorkflow as _runScoutSeasonRefreshWorkflow } from "./scout-season-refresh.ts";
import type {
  ScoutSeasonRefreshInput,
  ScoutSeasonRefreshResult,
} from "#activities/scout-season-refresh.ts";
import { runHomelabAuditWorkflow as _runHomelabAuditWorkflow } from "./homelab-audit.ts";
import type { RunHomelabAuditWorkflowInput } from "./homelab-audit.ts";
import { agentTaskWorkflow as _agentTaskWorkflow } from "./agent-task.ts";
import { cancelBuildkiteBuildsWorkflow as _cancelBuildkiteBuildsWorkflow } from "./cancel-buildkite-builds.ts";
import { checkPrMergeConflictsWorkflow as _checkPrMergeConflictsWorkflow } from "./check-pr-merge-conflicts.ts";
import { observeReviewSignalsWorkflow as _observeReviewSignalsWorkflow } from "./observe-review-signals.ts";
import type {
  ObserveReviewSignalsInput,
  ObserveReviewSignalsResult,
} from "#activities/observe-review-signals.ts";
import { observeAgentTaskTimeoutsWorkflow as _observeAgentTaskTimeoutsWorkflow } from "./observe-agent-task-timeouts.ts";
import type { ObserveAgentTaskTimeoutsResult } from "#activities/observe-agent-task-timeouts.ts";
import { pollWorkflowFailuresWorkflow as _pollWorkflowFailuresWorkflow } from "./workflow-failure-watch.ts";
import type { PollWorkflowFailuresResult } from "#activities/workflow-failure-watch.ts";
import type {
  CancelBuildkiteBuildsInput,
  CheckPrMergeConflictsInput,
} from "#shared/schemas.ts";
import type { AgentTaskInput } from "#shared/agent-task.ts";
import {
  runGlitterCorpusBackfill as _runGlitterCorpusBackfill,
  runGlitterCorpusChannelBackfill as _runGlitterCorpusChannelBackfill,
  runGlitterCorpusChannelOverlap as _runGlitterCorpusChannelOverlap,
  runGlitterCorpusDaily as _runGlitterCorpusDaily,
  runGlitterCorpusInventory as _runGlitterCorpusInventory,
} from "./glitter-corpus.ts";
import type {
  GlitterCorpusBackfillInput,
  GlitterCorpusChannelBackfillInput,
  GlitterCorpusChannelOverlapInput,
  GlitterCorpusSnapshotResult,
} from "./glitter-corpus.ts";
import type {
  ChannelStateResult,
  InventoryResult,
} from "#activities/glitter-corpus-activity-types.ts";
import { runGlitterContextRefresh as _runGlitterContextRefresh } from "./glitter-context-refresh.ts";
import type {
  GlitterContextRefreshInput,
  GlitterContextRefreshResult,
} from "#activities/glitter-context-refresh.ts";
import {
  runKometaWorkflow as _runKometaWorkflow,
  runBunCacheGcWorkflow as _runBunCacheGcWorkflow,
  runUvCachePruneWorkflow as _runUvCachePruneWorkflow,
  runTrivyDbRefreshWorkflow as _runTrivyDbRefreshWorkflow,
} from "./kubernetes-maintenance.ts";

export async function fetchSkillCappedManifest(): Promise<void> {
  return _fetchSkillCappedManifest();
}

export async function runKometaWorkflow(): Promise<void> {
  return _runKometaWorkflow();
}

export async function runBunCacheGcWorkflow(): Promise<void> {
  return _runBunCacheGcWorkflow();
}

export async function runUvCachePruneWorkflow(): Promise<void> {
  return _runUvCachePruneWorkflow();
}

export async function runTrivyDbRefreshWorkflow(): Promise<void> {
  return _runTrivyDbRefreshWorkflow();
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

export async function runScoutQueueWindowsWatch(): Promise<ScoutQueueWindowsResult> {
  return _runScoutQueueWindowsWatch();
}

export async function runScoutSeasonRefreshWorkflow(
  input: ScoutSeasonRefreshInput = {},
): Promise<ScoutSeasonRefreshResult> {
  return _runScoutSeasonRefreshWorkflow(input);
}

export async function runHomelabAuditWorkflow(
  input: RunHomelabAuditWorkflowInput = {},
): Promise<void> {
  return _runHomelabAuditWorkflow(input);
}

export async function agentTaskWorkflow(input: AgentTaskInput): Promise<void> {
  return _agentTaskWorkflow(input);
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

export async function observeReviewSignalsWorkflow(
  input: ObserveReviewSignalsInput = {},
): Promise<ObserveReviewSignalsResult> {
  return _observeReviewSignalsWorkflow(input);
}

export async function observeAgentTaskTimeoutsWorkflow(): Promise<ObserveAgentTaskTimeoutsResult> {
  return _observeAgentTaskTimeoutsWorkflow();
}

export async function pollWorkflowFailuresWorkflow(): Promise<PollWorkflowFailuresResult> {
  return _pollWorkflowFailuresWorkflow();
}

export async function runGlitterCorpusInventory(): Promise<InventoryResult> {
  return _runGlitterCorpusInventory();
}

export async function runGlitterContextRefresh(
  input: GlitterContextRefreshInput = {},
): Promise<GlitterContextRefreshResult> {
  return _runGlitterContextRefresh(input);
}

export async function runGlitterCorpusBackfill(
  input: GlitterCorpusBackfillInput,
): Promise<GlitterCorpusSnapshotResult> {
  return _runGlitterCorpusBackfill(input);
}

export async function runGlitterCorpusChannelBackfill(
  input: GlitterCorpusChannelBackfillInput,
): Promise<ChannelStateResult> {
  return _runGlitterCorpusChannelBackfill(input);
}

export async function runGlitterCorpusChannelOverlap(
  input: GlitterCorpusChannelOverlapInput,
): Promise<ChannelStateResult> {
  return _runGlitterCorpusChannelOverlap(input);
}

export async function runGlitterCorpusDaily(): Promise<GlitterCorpusSnapshotResult> {
  return _runGlitterCorpusDaily();
}
