import configuration from "#src/configuration.ts";

/**
 * Every tournament-v5 endpoint is `x-route-enum: regional` with
 * `x-platforms-available: ["americas"]`, so the host is fixed no matter which
 * shard the game is played on. The tournament region (NA / EUW / …) travels in
 * the request body, not the URL.
 */
const TOURNAMENT_HOST = "https://americas.api.riotgames.com";

/**
 * A non-2xx response from the tournament API.
 *
 * Carries a numeric `status` specifically so `extractHttpStatus` in
 * `upstream-errors.ts` reads it without modification: that helper parses
 * `{ status: coerce.number() }` off whatever twisted threw, and matching the
 * shape is what lets a hand-rolled client reuse the whole `riot-call.ts`
 * wrapper — metrics, health, Sentry policy, and the expected-outage list.
 */
export class TournamentHttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    body: string,
    retryAfterSeconds: number | undefined,
  ) {
    super(`Tournament API responded ${status.toString()}: ${body}`);
    this.name = "TournamentHttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type TournamentRequest = {
  method: "GET" | "POST" | "PUT";
  /** Path below the version prefix, e.g. `"codes"` or `"codes/NA1234a-…"`. */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
};

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/**
 * Issues one tournament API request and returns it in the `{ response }` shape
 * `runRiotCall` expects from a twisted call.
 *
 * Deliberately does NOT retry. twisted handles rate-limit retry for every other
 * Riot surface, but adding a second retry policy here would stack with the
 * caller's circuit breaker and hide a 429 from the metric that should show it.
 */
export async function tournamentFetch(
  basePath: string,
  request: TournamentRequest,
): Promise<{ response: unknown }> {
  const url = new URL(`${TOURNAMENT_HOST}/${basePath}/${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: request.method,
    headers: {
      "X-Riot-Token": configuration.riotApiToken,
      ...(request.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(request.body === undefined
      ? {}
      : { body: JSON.stringify(request.body) }),
  });

  if (!response.ok) {
    throw new TournamentHttpError(
      response.status,
      await response.text(),
      parseRetryAfter(response.headers.get("Retry-After")),
    );
  }

  // 204 and an empty body are legal for the code-update endpoint.
  const text = await response.text();
  if (text.length === 0) {
    return { response: undefined };
  }
  return { response: JSON.parse(text) };
}
