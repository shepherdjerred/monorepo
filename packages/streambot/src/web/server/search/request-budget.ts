/** Requests per session per minute; each kind of request draws on its own closed budget. */
export const REQUEST_BUDGETS = {
  count: 120,
  artwork: 600,
  search: 600,
} as const;
export type RequestBudget = keyof typeof REQUEST_BUDGETS;

/**
 * Artwork and typeahead come in bursts a human causes by typing, so they cannot share the budget
 * that protects commands. Search is sized for a client issuing a request per group per keystroke.
 */
export function requestBudget(pathname: string): RequestBudget {
  if (pathname === "/api/artwork" || pathname === "/api/music/artwork")
    return "artwork";
  return pathname === "/api/search/v2" ||
    pathname === "/api/search/v2/suggest" ||
    pathname === "/api/music/v2/album" ||
    pathname === "/api/music/v2/artist"
    ? "search"
    : "count";
}
