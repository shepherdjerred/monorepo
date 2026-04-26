import { fetcherActivities } from "./fetcher.ts";
import { depsSummaryActivities } from "./deps-summary.ts";
import { dnsAuditActivities } from "./dns-audit.ts";
import { golinkSyncActivities } from "./golink-sync.ts";
import { haActivities } from "./ha.ts";
import { zfsMaintenanceActivities } from "./zfs-maintenance.ts";
import { bugsinkHousekeepingActivities } from "./bugsink.ts";
import { dataDragonActivities } from "./data-dragon.ts";
import { docsGroomActivities } from "./docs-groom.ts";

export const activities = {
  ...fetcherActivities,
  ...depsSummaryActivities,
  ...dnsAuditActivities,
  ...golinkSyncActivities,
  ...haActivities,
  ...zfsMaintenanceActivities,
  ...bugsinkHousekeepingActivities,
  ...dataDragonActivities,
  ...docsGroomActivities,
};
