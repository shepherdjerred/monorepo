// Freshly added accounts resolve their Riot ID server-side within seconds, so
// the player page polls until every account resolves. Bound that polling: a
// permanently unresolvable account (or a Riot outage) would otherwise refetch
// forever, and each refetch re-hits the Riot Account API — many open player
// pages could amplify an outage into rate-limit exhaustion.
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 60; // ~5 minutes, then stop; reloading resumes.

/**
 * React Query `refetchInterval` value for the player page: poll while any
 * account is still unresolved, but give up after MAX_POLLS. `pollsRef` carries
 * the consecutive-poll count across calls and resets once everything resolves.
 */
export function nextRiotIdPollInterval(
  accounts: { riotGameName: string | null }[] | undefined,
  pollsRef: { current: number },
): number | false {
  const hasUnresolved =
    accounts?.some((account) => account.riotGameName === null) === true;
  if (!hasUnresolved) {
    pollsRef.current = 0;
    return false;
  }
  if (pollsRef.current >= MAX_POLLS) {
    return false;
  }
  pollsRef.current += 1;
  return POLL_INTERVAL_MS;
}
