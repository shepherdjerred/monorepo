/**
 * Retained no-op drain stub for replay compatibility while `freshrss-sync-hourly`
 * is deleted via `DELETED_SCHEDULE_IDS`. Replaced by `runFeedsRefreshWorkflow`.
 */
export function runFreshRssSyncWorkflow(): Promise<void> {
  return Promise.resolve();
}
