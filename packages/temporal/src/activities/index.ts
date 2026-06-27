import { fetcherActivities } from "./fetcher.ts";
import { depsSummaryActivities } from "./deps-summary.ts";
import { dnsAuditActivities } from "./dns-audit.ts";
import { golinkSyncActivities } from "./golink-sync.ts";
import { haActivities } from "./ha.ts";
import { homelabAuditActivities } from "./homelab-audit.ts";
import { agentTaskActivities } from "./agent-task.ts";
import { alertRemediationActivities } from "./alert-remediation.ts";
import { zfsMaintenanceActivities } from "./zfs-maintenance.ts";
import { bugsinkHousekeepingActivities } from "./bugsink.ts";
import { dataDragonActivities } from "./data-dragon.ts";
import { scoutSeasonRefreshActivities } from "./scout-season-refresh.ts";
import { prReviewActivities } from "./pr-review/index.ts";
import { prReviewEvalActivities } from "./pr-review-eval/index.ts";
import { prSummaryActivities } from "./pr-review/summary.ts";
import { veleroOrphanAuditActivities } from "./velero-orphan-audit.ts";
import { outcomeActivities } from "./outcome.ts";
import { cancelBuildkiteBuildsActivities } from "./cancel-buildkite-builds.ts";
import { checkPrMergeConflictsActivities } from "./check-pr-merge-conflicts.ts";
import { readmeRefreshActivities } from "./readme-refresh.ts";
import { llmCatalogRefreshActivities } from "./llm-catalog-refresh.ts";

export const activities = {
  ...fetcherActivities,
  ...depsSummaryActivities,
  ...dnsAuditActivities,
  ...golinkSyncActivities,
  ...haActivities,
  ...homelabAuditActivities,
  ...agentTaskActivities,
  ...alertRemediationActivities,
  ...zfsMaintenanceActivities,
  ...bugsinkHousekeepingActivities,
  ...dataDragonActivities,
  ...scoutSeasonRefreshActivities,
  ...prReviewActivities,
  ...prReviewEvalActivities,
  ...prSummaryActivities,
  ...veleroOrphanAuditActivities,
  ...outcomeActivities,
  ...cancelBuildkiteBuildsActivities,
  ...checkPrMergeConflictsActivities,
  ...readmeRefreshActivities,
  ...llmCatalogRefreshActivities,
};
