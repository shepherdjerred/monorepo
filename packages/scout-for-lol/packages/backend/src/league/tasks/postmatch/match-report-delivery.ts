export const MAX_DISCORD_ALERT_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * The instant after which this match's report is stale.
 *
 * This is the post-match notification intent's freshness deadline: the
 * intent's `beginSend` refuses to record a send started past it.
 */
export function postmatchReportFreshnessDeadline(gameCreation: number): Date {
  return new Date(gameCreation + MAX_DISCORD_ALERT_AGE_MS);
}

/** Both this and `beginSend` compare STRICTLY after, so the deadline itself still delivers. */
export function isPostmatchReportStale(
  gameCreation: number,
  now: Date,
): boolean {
  return (
    now.getTime() > postmatchReportFreshnessDeadline(gameCreation).getTime()
  );
}
