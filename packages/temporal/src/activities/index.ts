import { fetcherActivities } from "./fetcher.ts";
import { depsSummaryActivities } from "./maintenance/deps-summary.ts";
import { depsSummaryLegacyActivities } from "./maintenance/deps-summary-legacy.ts";
import { dnsAuditActivities } from "./homelab/dns-audit.ts";
import {
  golinkClusterActivities,
  golinkSyncActivities,
} from "./golink-sync.ts";
import { haActivities } from "./ha.ts";
import { homelabAuditActivities } from "./homelab/homelab-audit.ts";
import { homelabAuditCollectorActivities } from "./homelab/homelab-audit-collectors.ts";
import { agentTaskActivities } from "./agent/agent-task.ts";
import { zfsMaintenanceActivities } from "./homelab/zfs-maintenance.ts";
import { bugsinkHousekeepingActivities } from "./bugsink.ts";
import { dataDragonActivities } from "./data-dragon/data-dragon.ts";
import { lanePriorActivities } from "./lane-prior-refresh.ts";
import { scoutSeasonRefreshActivities } from "./scout/scout-season-refresh.ts";
import { veleroOrphanAuditActivities } from "./homelab/velero-orphan-audit.ts";
import { outcomeActivities } from "./outcome.ts";
import { cancelBuildkiteBuildsActivities } from "./cancel-buildkite-builds.ts";
import { checkPrMergeConflictsActivities } from "./maintenance/check-pr-merge-conflicts.ts";
import { llmCatalogRefreshActivities } from "./agent/llm-catalog-refresh.ts";
import { scoutImageGcActivities } from "./scout/scout-image-gc.ts";
import { homelabCrdImportsRefreshActivities } from "./homelab/homelab-crd-imports-refresh.ts";
import { pokeemeraldDataRefreshActivities } from "./dpp-pokeemerald-data-refresh.ts";
import { scoutShowcaseRefreshActivities } from "./scout/scout-showcase-refresh.ts";
import { scoutQueueWindowsActivities } from "./scout/scout-queue-windows.ts";
import { glitterCorpusActivities } from "./glitter/corpus/glitter-corpus.ts";
import { glitterContextRefreshActivities } from "./glitter/context/glitter-context-refresh.ts";
import { glitterContextAuditActivities } from "./glitter/context/glitter-context-audit.ts";
import { weatherActivities } from "./weather.ts";
import { workflowFailureWatchActivities } from "./maintenance/workflow-failure-watch-activity.ts";
import { maintenanceActivities } from "./maintenance/maintenance.ts";
import { mainVulnScanActivities } from "./maintenance/main-vuln-scan.ts";
import { mainVulnScanAlertActivities } from "./maintenance/main-vuln-scan-alerts.ts";
import { linkRotScanActivities } from "./maintenance/link-rot-scan.ts";
import { linkRotScanAlertActivities } from "./maintenance/link-rot-scan-alerts.ts";
import { reportDeliveryActivities } from "./reports/report-delivery.ts";
import { protobufWatchActivities } from "./maintenance/protobuf-watch.ts";
import { tasknotesCanaryActivities } from "./maintenance/tasknotes-canary.ts";
import { reportFreshnessActivities } from "./reports/report-freshness.ts";
import { ciIoImpactActivities } from "./maintenance/ci-io-impact.ts";
import { freshrssActivities } from "./maintenance/freshrss.ts";
import { scoutWeeklyParlayActivities } from "./scout/scout-weekly-parlay.ts";
import { scoutBryanBucksActivities } from "./scout/scout-bryan-bucks.ts";
import { fliptFlagInventoryActivities } from "./flipt-flag-inventory.ts";
import { seaweedFsBackupActivities } from "./homelab/seaweedfs-backup.ts";
import { openAiComplimentaryUsageActivities } from "./agent/openai-complimentary-usage.ts";

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
  ...glitterContextAuditActivities,
};

export const maintenanceWorkerActivities = {
  ...maintenanceActivities,
  ...mainVulnScanActivities,
  ...linkRotScanActivities,
};
export const backupWorkerActivities = {
  ...seaweedFsBackupActivities,
};

export const billingActivities = {
  ...openAiComplimentaryUsageActivities,
};
