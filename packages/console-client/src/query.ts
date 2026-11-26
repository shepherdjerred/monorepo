import { QueryClient, type DefaultOptions } from "@tanstack/react-query";

/**
 * The one set of query defaults every console uses (Hub's, before the kit):
 *
 * - `retry: 1` — a blip is retried once; a real outage shows its error at once.
 * - `staleTime: 15_000` — navigating back within 15s reuses data instead of
 *   refetching; live consoles push changes through subscriptions anyway.
 * - `refetchOnWindowFocus: true` — returning to the tab refreshes stale data.
 */
export const CONSOLE_QUERY_DEFAULTS = {
  queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: true },
} as const satisfies DefaultOptions;

export function createConsoleQueryClient(
  overrides: DefaultOptions = {},
): QueryClient {
  return new QueryClient({
    defaultOptions: {
      ...overrides,
      queries: { ...CONSOLE_QUERY_DEFAULTS.queries, ...overrides.queries },
    },
  });
}
