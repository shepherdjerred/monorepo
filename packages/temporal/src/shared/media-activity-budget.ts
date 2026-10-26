/** Retain the ordinary Media Activities' historical server-normalized total.
 * Declare it explicitly because other servers expose an omitted total as zero.
 * Per-attempt SDK deadlines and invocation proof limits still take precedence.
 */
export const HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS = 315_360_000_000;
