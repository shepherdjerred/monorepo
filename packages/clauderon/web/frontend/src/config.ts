/**
 * Sentry DSN for error reporting. Set to empty string to disable Sentry.
 * Typed as `string` (not a literal) so consumers can check for empty string.
 */
export function getSentryDsn(): string {
  return "https://5c677804366f491d82c272e36edbbdce@bugsink.sjer.red/6";
}
