import configuration from "#src/configuration.ts";
import { RateLimiter } from "#src/league/api/client/rate-limiter.ts";

/**
 * Every tournament-v5 endpoint is `x-route-enum: regional` with
 * `x-platforms-available: ["americas"]`, so the host is fixed no matter which
 * shard the game is played on. The tournament region (NA / EUW / …) travels in
 * the request body, not the URL.
 */
const TOURNAMENT_HOST = "https://americas.api.riotgames.com";

/**
 * Shares the shape of the main client's limiter so tournament calls obey the
 * same process-wide 429 cooldown: the limiter establishes Riot's Retry-After
 * window before releasing a slot, which is the property that keeps a burst of
 * lobby polls from stacking retries on top of a rate limit.
 */
const rateLimiter = new RateLimiter({ concurrency: 5, maxRetries: 3 });

export type TournamentRequest = {
  method: "GET" | "POST" | "PUT";
  /** Path below the version prefix, e.g. `"codes"` or `"codes/NA1234a-…"`. */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
};

/**
 * Issues one tournament API request and returns the decoded payload, which is
 * what `runRiotCall` now hands to the schema.
 *
 * Non-2xx responses surface as `RiotHttpError`, thrown by the shared limiter.
 * That specific type matters: `extractHttpStatus` is `instanceof RiotHttpError`
 * on purpose, so that similarly-shaped errors from Discord and elsewhere do not
 * inherit Riot's upstream-outage policy. Throwing anything else here would
 * silently opt every tournament call out of the 404 handling, the expected-
 * outage list, and the Sentry rules in `riot-call.ts`.
 */
export async function tournamentFetch(
  basePath: string,
  request: TournamentRequest,
): Promise<unknown> {
  const url = new URL(`${TOURNAMENT_HOST}/${basePath}/${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const href = url.toString();

  const response = await rateLimiter.execute(href, () =>
    fetch(href, {
      method: request.method,
      headers: {
        "X-Riot-Token": configuration.riotApiToken,
        Accept: "application/json",
        ...(request.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
    }),
  );

  // 204 and an empty body are legal for the code-update endpoint.
  const text = await response.text();
  return text.length === 0 ? undefined : JSON.parse(text);
}
