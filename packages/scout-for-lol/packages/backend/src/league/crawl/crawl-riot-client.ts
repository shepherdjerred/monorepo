import type {
  LeaguePuuid,
  PlatformRoute,
  RegionalRoute,
  RiotMatchId,
} from "@scout-for-lol/data";
import {
  RiotClient,
  type FetchFunction,
} from "#src/league/api/client/riot-client.ts";
import type {
  BudgetRefusal,
  RateLimitedRequestOptions,
} from "#src/league/api/client/rate-limiter.ts";
import type {
  RiotBudgetLedger,
  RiotBudgetMode,
} from "#src/league/api/client/rate-budget.ts";

/**
 * Every call the crawl makes is the lowest-priority `crawl` class and is never
 * retried: a refused or failed request is simply not crawled this tick.
 */
const CRAWL_REQUEST: RateLimitedRequestOptions = {
  priority: "crawl",
  maxRetries: 0,
  retryUpstreamErrors: false,
};

export type CrawlRiotClientOptions = {
  apiKey: string;
  budgetMode: () => RiotBudgetMode;
  onBudgetRefusal?: ((refusal: BudgetRefusal) => void) | undefined;
  /** Tests only. */
  fetchFn?: FetchFunction | undefined;
  /** Tests only. */
  ledger?: RiotBudgetLedger | undefined;
};

/** The crawl's four Riot reads. */
export type CrawlRiotApi = {
  matchIds: (
    puuid: LeaguePuuid,
    regionalRoute: RegionalRoute,
    params: { queue: number; startTime: number; count: number },
  ) => Promise<RiotMatchId[]>;
  match: (
    matchId: RiotMatchId,
    regionalRoute: RegionalRoute,
  ) => Promise<unknown>;
  timeline: (
    matchId: RiotMatchId,
    regionalRoute: RegionalRoute,
  ) => Promise<unknown>;
  leagueEntries: (
    puuid: LeaguePuuid,
    platform: PlatformRoute,
  ) => Promise<unknown>;
};

/**
 * The crawl's own `RiotClient`: no retries and no `onPayload` capture (crawl
 * payloads are stored only by the crawl's segment writer, never through the
 * tracked-match evidence capture), with every request tagged `crawl`.
 */
export function createCrawlRiotClient(
  options: CrawlRiotClientOptions,
): CrawlRiotApi {
  const client = new RiotClient({
    apiKey: options.apiKey,
    concurrency: 2,
    maxRetries: 0,
    reservedRealtimeSlots: 1,
    budgetMode: options.budgetMode,
    onBudgetRefusal: options.onBudgetRefusal,
    ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
    ...(options.ledger === undefined ? {} : { ledger: options.ledger }),
  });
  return {
    matchIds: (puuid, regionalRoute, params) =>
      client.match.list(puuid, regionalRoute, params, CRAWL_REQUEST),
    match: (matchId, regionalRoute) =>
      client.match.get(matchId, regionalRoute, CRAWL_REQUEST),
    timeline: (matchId, regionalRoute) =>
      client.match.timeline(matchId, regionalRoute, CRAWL_REQUEST),
    leagueEntries: (puuid, platform) =>
      client.league.byPuuid(puuid, platform, CRAWL_REQUEST),
  };
}
