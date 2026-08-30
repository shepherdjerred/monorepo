import { fetcherActivities } from "./fetcher.ts";
import { depsSummaryActivities } from "./deps-summary.ts";
import { depsSummaryLegacyActivities } from "./deps-summary-legacy.ts";
import { dnsAuditActivities } from "./dns-audit.ts";
import {
  golinkClusterActivities,
  golinkSyncActivities,
} from "./golink-sync.ts";
import { haActivities } from "./ha.ts";
import { homelabAuditActivities } from "./homelab-audit.ts";
import { homelabAuditCollectorActivities } from "./homelab-audit-collectors.ts";
import { agentTaskActivities } from "./agent-task.ts";
import { zfsMaintenanceActivities } from "./zfs-maintenance.ts";
import { bugsinkHousekeepingActivities } from "./bugsink.ts";
import { dataDragonActivities } from "./data-dragon.ts";
import { lanePriorActivities } from "./lane-prior-refresh.ts";
import { scoutSeasonRefreshActivities } from "./scout-season-refresh.ts";
import { veleroOrphanAuditActivities } from "./velero-orphan-audit.ts";
import { outcomeActivities } from "./outcome.ts";
import { cancelBuildkiteBuildsActivities } from "./cancel-buildkite-builds.ts";
import { checkPrMergeConflictsActivities } from "./check-pr-merge-conflicts.ts";
import { llmCatalogRefreshActivities } from "./llm-catalog-refresh.ts";
import { scoutImageGcActivities } from "./scout-image-gc.ts";
import { homelabCrdImportsRefreshActivities } from "./homelab-crd-imports-refresh.ts";
import { pokeemeraldDataRefreshActivities } from "./dpp-pokeemerald-data-refresh.ts";
import { scoutShowcaseRefreshActivities } from "./scout-showcase-refresh.ts";
import { scoutQueueWindowsActivities } from "./scout-queue-windows.ts";
import { glitterCorpusActivities } from "./glitter-corpus.ts";
import { glitterContextRefreshActivities } from "./glitter-context-refresh.ts";
import { weatherActivities } from "./weather.ts";
import { workflowFailureWatchActivities } from "./workflow-failure-watch-activity.ts";
import { maintenanceActivities } from "./maintenance.ts";
import { mainVulnScanActivities } from "./main-vuln-scan.ts";
import { mainVulnScanAlertActivities } from "./main-vuln-scan-alerts.ts";
import { linkRotScanActivities } from "./link-rot-scan.ts";
import { linkRotScanAlertActivities } from "./link-rot-scan-alerts.ts";
import { reportDeliveryActivities } from "./report-delivery.ts";
import { protobufWatchActivities } from "./protobuf-watch.ts";
import { tasknotesCanaryActivities } from "./tasknotes-canary.ts";
import { reportFreshnessActivities } from "./report-freshness.ts";
import { ciIoImpactActivities } from "./ci-io-impact.ts";
import { freshrssActivities } from "./freshrss.ts";
import { scoutWeeklyParlayActivities } from "./scout-weekly-parlay.ts";
import { scoutBryanBucksActivities } from "./scout-bryan-bucks.ts";
import { fliptFlagInventoryActivities } from "./flipt-flag-inventory.ts";
import { seaweedFsBackupActivities } from "./seaweedfs-backup.ts";

export const homeActivities = {
  ...haActivities,
  ...weatherActivities,
  ...outcomeActivities,
};

export const reportActivities = {
  ...reportDeliveryActivities,
  ...reportFreshnessActivities,
  ...workflowFailureWatchActivities,
  sendAgentTaskEmail: agentTaskActivities.sendAgentTaskEmail,
  sendAgentTaskFailureReport: agentTaskActivities.sendAgentTaskFailureReport,
  ...mainVulnScanAlertActivities,
  ...linkRotScanAlertActivities,
};

export const infraActivities = {
  ...dnsAuditActivities,
  ...homelabAuditActivities,
  ...homelabAuditCollectorActivities,
  ...zfsMaintenanceActivities,
  ...bugsinkHousekeepingActivities,
  ...veleroOrphanAuditActivities,
  ...homelabCrdImportsRefreshActivities,
  ...tasknotesCanaryActivities,
  ...golinkClusterActivities,
  ...ciIoImpactActivities,
};

export const repoActivities = {
  ...fetcherActivities,
  ...depsSummaryActivities,
  ...depsSummaryLegacyActivities,
  ...golinkSyncActivities,
  ...cancelBuildkiteBuildsActivities,
  ...checkPrMergeConflictsActivities,
  ...llmCatalogRefreshActivities,
  ...pokeemeraldDataRefreshActivities,
  ...protobufWatchActivities,
  ...freshrssActivities,
  ...fliptFlagInventoryActivities,
};

export const scoutActivities = {
  ...dataDragonActivities,
  ...lanePriorActivities,
  ...scoutSeasonRefreshActivities,
  ...scoutImageGcActivities,
  ...scoutShowcaseRefreshActivities,
  ...scoutQueueWindowsActivities,
  ...scoutWeeklyParlayActivities,
  ...scoutBryanBucksActivities,
};

export const agentActivities = {
  ...agentTaskActivities,
};

export const glitterCorpusWorkerActivities = {
  ...glitterCorpusActivities,
};

export const glitterContextWorkerActivities = {
  ...glitterContextRefreshActivities,
};

export const maintenanceWorkerActivities = {
  ...maintenanceActivities,
  ...mainVulnScanActivities,
  ...linkRotScanActivities,
};
export const backupWorkerActivities = {
  ...seaweedFsBackupActivities,
};
