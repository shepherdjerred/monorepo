/**
 * Parses Riot's `X-App-Rate-Limit` / `X-App-Rate-Limit-Count` response
 * headers into structured per-window rate-limit accounting.
 *
 * Both headers share the same comma-separated `N:W` format, e.g.
 * `"20:1,100:120"` means 20 requests per 1-second window AND 100 requests
 * per 120-second window. `X-App-Rate-Limit` carries the ceiling for each
 * window; `X-App-Rate-Limit-Count` carries the current usage.
 *
 * `X-Method-Rate-Limit` / `X-Method-Rate-Limit-Count` share the same format
 * but apply to a single endpoint (method) on one routing host. This module
 * also classifies `X-Rate-Limit-Type` and derives bounded metric labels (route
 * host and templated method key) from a request URL. Everything here is pure
 * and observation-only.
 */

export type AppRateLimitWindow = {
  windowSeconds: number;
  count: number;
  limit: number;
};

function parseRateLimitPairs(
  header: string,
): { value: number; windowSeconds: number }[] {
  const pairs: { value: number; windowSeconds: number }[] = [];

  for (const entry of header.split(",")) {
    const [rawValue, rawWindowSeconds] = entry.split(":");
    if (rawValue === undefined || rawWindowSeconds === undefined) {
      continue;
    }

    const value = Number(rawValue.trim());
    const windowSeconds = Number(rawWindowSeconds.trim());
    if (!Number.isFinite(value) || !Number.isFinite(windowSeconds)) {
      continue;
    }

    pairs.push({ value, windowSeconds });
  }

  return pairs;
}

/**
 * Parses Riot's app rate-limit ceiling and usage headers into per-window
 * accounting, matching windows by their window-seconds key rather than by
 * array position (Riot does not guarantee the two headers list windows in
 * the same order).
 */
export function parseAppRateLimitWindows(
  headers: Headers,
): AppRateLimitWindow[] {
  return zipWindows(
    headers.get("x-app-rate-limit"),
    headers.get("x-app-rate-limit-count"),
  );
}

export type MethodRateLimitWindow = AppRateLimitWindow;

/**
 * Parses `X-Method-Rate-Limit` and `X-Method-Rate-Limit-Count`, which use the
 * same `N:W` format as the app headers but describe one endpoint's budget.
 */
export function parseMethodRateLimitWindows(
  headers: Headers,
): MethodRateLimitWindow[] {
  return zipWindows(
    headers.get("x-method-rate-limit"),
    headers.get("x-method-rate-limit-count"),
  );
}

function zipWindows(
  limitHeader: string | null,
  countHeader: string | null,
): AppRateLimitWindow[] {
  if (limitHeader === null || countHeader === null) {
    return [];
  }

  const limits = parseRateLimitPairs(limitHeader);
  const counts = parseRateLimitPairs(countHeader);

  const countsByWindow = new Map<number, number>();
  for (const count of counts) {
    countsByWindow.set(count.windowSeconds, count.value);
  }

  const windows: AppRateLimitWindow[] = [];
  for (const limit of limits) {
    const count = countsByWindow.get(limit.windowSeconds);
    if (count === undefined) {
      continue;
    }

    windows.push({
      windowSeconds: limit.windowSeconds,
      count,
      limit: limit.value,
    });
  }

  return windows;
}

export type RateLimitType = "application" | "method" | "service" | "unknown";

/**
 * Classifies which limit Riot enforced from `X-Rate-Limit-Type`. Riot sends it
 * on 429 responses (`application`, `method`, or `service`); anything else,
 * including absence, is `unknown`.
 */
export function parseRateLimitType(headers: Headers): RateLimitType {
  const value = headers.get("x-rate-limit-type")?.trim().toLowerCase();
  return value === "application" || value === "method" || value === "service"
    ? value
    : "unknown";
}

const RIOT_HOST_SUFFIX = ".api.riotgames.com";
const ROUTE_PATTERN = /^[a-z]{2,6}\d{0,2}$/;

/**
 * Returns the Riot routing host label (`americas`, `na1`, ...) for a request
 * URL, or `other` when the URL is not a Riot API host. Bounded by Riot's
 * fixed set of platform and regional routes.
 */
export function routeOfUrl(url: string): string {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (!hostname.endsWith(RIOT_HOST_SUFFIX)) {
    return "other";
  }
  const route = hostname.slice(0, -RIOT_HOST_SUFFIX.length);
  return ROUTE_PATTERN.test(route) ? route : "other";
}

/**
 * Known Riot endpoints as path templates. A fixed allow-list keeps the metric
 * label bounded: unrecognised paths collapse to `other` rather than leaking
 * ids into label values. More specific templates come first.
 */
const METHOD_TEMPLATES: readonly { pattern: RegExp; key: string }[] = [
  {
    pattern: /^\/riot\/account\/v1\/accounts\/by-puuid\/[^/]+$/,
    key: "/riot/account/v1/accounts/by-puuid/{puuid}",
  },
  {
    pattern: /^\/riot\/account\/v1\/accounts\/by-riot-id\/[^/]+\/[^/]+$/,
    key: "/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}",
  },
  {
    pattern: /^\/lol\/match\/v5\/matches\/by-puuid\/[^/]+\/ids$/,
    key: "/lol/match/v5/matches/by-puuid/{puuid}/ids",
  },
  {
    pattern: /^\/lol\/match\/v5\/matches\/[^/]+\/timeline$/,
    key: "/lol/match/v5/matches/{matchId}/timeline",
  },
  {
    pattern: /^\/lol\/match\/v5\/matches\/[^/]+$/,
    key: "/lol/match/v5/matches/{matchId}",
  },
  {
    pattern: /^\/lol\/league\/v4\/entries\/by-puuid\/[^/]+$/,
    key: "/lol/league/v4/entries/by-puuid/{puuid}",
  },
  {
    pattern:
      /^\/lol\/champion-mastery\/v4\/champion-masteries\/by-puuid\/[^/]+\/top$/,
    key: "/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}/top",
  },
  {
    pattern:
      /^\/lol\/champion-mastery\/v4\/champion-masteries\/by-puuid\/[^/]+$/,
    key: "/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}",
  },
  {
    pattern: /^\/lol\/spectator\/v5\/active-games\/by-summoner\/[^/]+$/,
    key: "/lol/spectator/v5/active-games/by-summoner/{puuid}",
  },
  {
    pattern: /^\/lol\/clash\/v1\/tournaments$/,
    key: "/lol/clash/v1/tournaments",
  },
  {
    pattern: /^\/lol\/clash\/v1\/players\/by-puuid\/[^/]+$/,
    key: "/lol/clash/v1/players/by-puuid/{puuid}",
  },
  {
    pattern: /^\/lol\/clash\/v1\/teams\/[^/]+$/,
    key: "/lol/clash/v1/teams/{teamId}",
  },
];

/**
 * Returns the templated endpoint (ids replaced, query string dropped) for a
 * Riot request URL, or `other` for anything outside the known set.
 */
export function methodKeyOfUrl(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return "other";
  }
  for (const { pattern, key } of METHOD_TEMPLATES) {
    if (pattern.test(pathname)) {
      return key;
    }
  }
  return "other";
}
