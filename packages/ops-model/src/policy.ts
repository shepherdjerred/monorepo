/**
 * Operational policy shared by the collector and every renderer. These are
 * product decisions, not deployment settings: change them here, in review.
 */
export const OPS_POLICY = {
  /** Cadence of the Temporal `ops-snapshot` schedule. */
  snapshotIntervalMinutes: 5,
  /** A snapshot or source older than this many intervals renders `unknown`. */
  staleAfterIntervals: 3,
  /** Argo apps may be OutOfSync this long (a sync in flight) before warning. */
  argoOutOfSyncGraceMinutes: 15,
  /** Firing alerts older than this become `needsMe`. */
  alertNeedsMeAfterMinutes: 30,
  /** Open PRs untouched this long are stale. */
  pullRequestStaleDays: 7,
  /** Subscription quota window usage thresholds (0..1). */
  quotaWarningRatio: 0.8,
  quotaErrorRatio: 0.95,
  /**
   * Month-to-date pay-as-you-go API spend budget across OpenAI, Anthropic,
   * and Google, excluding fixed subscriptions.
   */
  monthlyApiBudgetUsd: 100,
  /** Warn once the month-end projection exceeds this share of budget. */
  budgetProjectionWarningRatio: 1,
  /** Certificates expiring within this many days warn; half of it errors. */
  certificateExpiryWarningDays: 14,
  /** Filesystems above these used ratios warn / error. */
  diskWarningRatio: 0.8,
  diskErrorRatio: 0.9,
  /** Backups older than this many hours are stale. */
  backupMaxAgeHours: 36,
  /** Root traces slower than this are listed as slow in the last hour. */
  slowTraceSeconds: 5,
  /**
   * Tempo search result cap per query. Tempo has no TraceQL metrics here,
   * so counts come from search results; a full page is reported as "≥".
   */
  traceSearchLimit: 500,
  /** Hourly snapshot samples are retained this long for review trends. */
  snapshotHistoryDays: 90,
} as const;

export const SNAPSHOT_STALE_AFTER_MS =
  OPS_POLICY.snapshotIntervalMinutes * OPS_POLICY.staleAfterIntervals * 60_000;
