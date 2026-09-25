/**
 * Headline metric ids. The collector emits them and renderers (web tiles,
 * TRMNL, digest, CLI) read them, so both sides share these constants.
 */
export const METRIC_IDS = {
  alertsFiring: "alerts.firing",
  alertsCritical: "alerts.critical",
  alertsWarning: "alerts.warning",

  nodesReady: "nodes.ready",
  nodesTotal: "nodes.total",
  podsUnhealthy: "pods.unhealthy",
  argoAppsUnhealthy: "argo.apps.unhealthy",
  argoAppsOutOfSync: "argo.apps.out_of_sync",
  cpuUsedRatio: "cluster.cpu.used_ratio",
  memoryUsedRatio: "cluster.memory.used_ratio",

  prsOpen: "github.prs.open",
  prsAwaitingMe: "github.prs.awaiting_me",
  prsMerged7d: "github.prs.merged_7d",
  prMedianHoursToMerge30d: "github.prs.median_hours_to_merge_30d",
  renovatePending: "renovate.pending",
  renovateAwaitingApproval: "renovate.awaiting_approval",

  linearOpen: "linear.issues.open",
  linearTriage: "linear.issues.triage",

  bugsinkUnresolved: "bugsink.issues.unresolved",

  probesDown: "probes.down",
  pageviews24h: "posthog.pageviews_24h",

  aiCostMonthToDateUsd: "ai.cost.month_to_date_usd",
  aiCostProjectedUsd: "ai.cost.projected_month_usd",
  aiTokens24h: "ai.tokens_24h",
  aiQuotaMaxUsedRatio: "ai.quota.max_used_ratio",

  diskMaxUsedRatio: "maintenance.disk.max_used_ratio",
  certificatesExpiringSoon: "maintenance.certificates.expiring_soon",
  backupsStale: "maintenance.backups.stale",

  logErrors1h: "logs.errors_1h",
} as const;

export type MetricId = (typeof METRIC_IDS)[keyof typeof METRIC_IDS];
