/**
 * Days of `scout-prod` match evidence the queue-window watch reads.
 *
 * Shared because the activity queries over this window and the workflow's
 * report states it as provenance; when the two were separate literals the
 * emailed report claimed a 21-day query over 28 days of data. Must stay above
 * the drift engine's `MIN_DRIFT_LOOKBACK_DAYS`: the lookback bounds how many
 * consecutive runs re-derive a close proposal, and the job closes the proposal
 * PR the moment a run produces no drift. See `CLOSE_MIN_ELIGIBLE_RUNS` in
 * `queue-window-drift.ts`, and keep it in step with the copy referenced by
 * `packages/scout-for-lol/packages/backend/scripts/update-queue-windows.ts`.
 *
 * Lives in `shared/` so workflow code can import it without pulling the
 * activity module into the workflow bundle.
 */
export const SCOUT_QUEUE_WINDOWS_LOOKBACK_DAYS = 28;
