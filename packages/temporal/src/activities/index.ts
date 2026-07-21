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
import { prReviewActivities } from "./pr-review/index.ts";
import { prSummaryActivities } from "./pr-review/summary.ts";
import { veleroOrphanAuditActivities } from "./velero-orphan-audit.ts";
import { outcomeActivities } from "./outcome.ts";
import { cancelBuildkiteBuildsActivities } from "./cancel-buildkite-builds.ts";
import { checkPrMergeConflictsActivities } from "./check-pr-merge-conflicts.ts";
import { readmeRefreshActivities } from "./readme-refresh.ts";
import { llmCatalogRefreshActivities } from "./llm-catalog-refresh.ts";
import { prBabysitActivities } from "./pr-babysit/index.ts";
import { scoutImageGcActivities } from "./scout-image-gc.ts";
import { homelabCrdImportsRefreshActivities } from "./homelab-crd-imports-refresh.ts";
import { scoutShowcaseRefreshActivities } from "./scout-showcase-refresh.ts";

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
  ...prReviewActivities,
  ...prSummaryActivities,
  ...veleroOrphanAuditActivities,
  ...outcomeActivities,
  ...cancelBuildkiteBuildsActivities,
  ...checkPrMergeConflictsActivities,
  ...readmeRefreshActivities,
  ...llmCatalogRefreshActivities,
  ...prBabysitActivities,
  ...scoutImageGcActivities,
  ...homelabCrdImportsRefreshActivities,
  ...scoutShowcaseRefreshActivities,
};
