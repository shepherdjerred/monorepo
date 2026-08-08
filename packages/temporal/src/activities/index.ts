import { fetcherActivities } from "./fetcher.ts";
import { depsSummaryActivities } from "./deps-summary.ts";
import { dnsAuditActivities } from "./dns-audit.ts";
import { golinkSyncActivities } from "./golink-sync.ts";
import { haActivities } from "./ha.ts";
import { homelabAuditActivities } from "./homelab-audit.ts";
import { agentTaskActivities } from "./agent-task.ts";
import { zfsMaintenanceActivities } from "./zfs-maintenance.ts";
import { bugsinkHousekeepingActivities } from "./bugsink.ts";
import { dataDragonActivities } from "./data-dragon.ts";
import { scoutSeasonRefreshActivities } from "./scout-season-refresh.ts";
import { veleroOrphanAuditActivities } from "./velero-orphan-audit.ts";
import { outcomeActivities } from "./outcome.ts";
import { cancelBuildkiteBuildsActivities } from "./cancel-buildkite-builds.ts";
import { checkPrMergeConflictsActivities } from "./check-pr-merge-conflicts.ts";
import { readmeRefreshActivities } from "./readme-refresh.ts";
import { llmCatalogRefreshActivities } from "./llm-catalog-refresh.ts";
import { scoutImageGcActivities } from "./scout-image-gc.ts";
import { homelabCrdImportsRefreshActivities } from "./homelab-crd-imports-refresh.ts";
import { pokeemeraldDataRefreshActivities } from "./dpp-pokeemerald-data-refresh.ts";
import { scoutShowcaseRefreshActivities } from "./scout-showcase-refresh.ts";
import { scoutQueueWindowsActivities } from "./scout-queue-windows.ts";
import { observeReviewSignalsActivities } from "./observe-review-signals.ts";
import { glitterCorpusActivities } from "./glitter-corpus.ts";
import { glitterContextRefreshActivities } from "./glitter-context-refresh.ts";
import { weatherActivities } from "./weather.ts";
import { workflowFailureWatchActivities } from "./workflow-failure-watch.ts";

export const activities = {
  ...fetcherActivities,
  ...depsSummaryActivities,
  ...dnsAuditActivities,
  ...golinkSyncActivities,
  ...haActivities,
  ...homelabAuditActivities,
  ...agentTaskActivities,
  ...zfsMaintenanceActivities,
  ...bugsinkHousekeepingActivities,
  ...dataDragonActivities,
  ...scoutSeasonRefreshActivities,
  ...veleroOrphanAuditActivities,
  ...outcomeActivities,
  ...cancelBuildkiteBuildsActivities,
  ...checkPrMergeConflictsActivities,
  ...readmeRefreshActivities,
  ...llmCatalogRefreshActivities,
  ...scoutImageGcActivities,
  ...homelabCrdImportsRefreshActivities,
  ...pokeemeraldDataRefreshActivities,
  ...scoutShowcaseRefreshActivities,
  ...scoutQueueWindowsActivities,
  ...observeReviewSignalsActivities,
  ...glitterCorpusActivities,
  ...glitterContextRefreshActivities,
  ...weatherActivities,
  ...workflowFailureWatchActivities,
};
