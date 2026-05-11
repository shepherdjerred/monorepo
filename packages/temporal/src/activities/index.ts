import { fetcherActivities } from "./fetcher.ts";
import { depsSummaryActivities } from "./deps-summary.ts";
import { dnsAuditActivities } from "./dns-audit.ts";
import { golinkSyncActivities } from "./golink-sync.ts";
import { haActivities } from "./ha.ts";
import { homelabAuditActivities } from "./homelab-audit.ts";
import { zfsMaintenanceActivities } from "./zfs-maintenance.ts";
import { bugsinkHousekeepingActivities } from "./bugsink.ts";
import { dataDragonActivities } from "./data-dragon.ts";
import { prAgentActivities } from "./pr-agent.ts";
import { prReviewActivities } from "./pr-review/index.ts";
import { prReviewEvalActivities } from "./pr-review-eval/index.ts";
import { prSummaryActivities } from "./pr-review/summary.ts";
import { veleroOrphanAuditActivities } from "./velero-orphan-audit.ts";
import { outcomeActivities } from "./outcome.ts";

export const activities = {
  ...fetcherActivities,
  ...depsSummaryActivities,
  ...dnsAuditActivities,
  ...golinkSyncActivities,
  ...haActivities,
  ...homelabAuditActivities,
  ...zfsMaintenanceActivities,
  ...bugsinkHousekeepingActivities,
  ...dataDragonActivities,
  ...prAgentActivities,
  ...prReviewActivities,
  ...prReviewEvalActivities,
  ...prSummaryActivities,
  ...veleroOrphanAuditActivities,
  ...outcomeActivities,
};
