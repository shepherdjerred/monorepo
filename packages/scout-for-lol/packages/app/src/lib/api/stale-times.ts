/**
 * staleTime for slow-changing admin lists (channels, roles, guilds, players,
 * competitions, reports, audit). Mutations invalidate their keys explicitly,
 * so a longer freshness window only suppresses redundant background refetches.
 */
export const STALE_TIME_SLOW_LIST = 5 * 60 * 1000;
