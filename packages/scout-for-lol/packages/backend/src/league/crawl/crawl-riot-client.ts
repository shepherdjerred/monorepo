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
import type { RiotBudgetLedger } from "#src/league/api/client/rate-budget.ts";

/**
 * Every call the crawl makes is the lowest-priority `crawl` class, is never
 * retried, and is refused rather than held when the budget says no: the
 * refusal (`RiotBudgetRefusedError`) goes back to the tick, which waits or
 * stops. That holds in every budget mode, so the crawl's target binds even
 * while tracked traffic is only observed.
 */
const CRAWL_REQUEST: RateLimitedRequestOptions = {
  priority: "crawl",
  maxRetries: 0,
  retryUpstreamErrors: false,
  refuseOverBudget: true,
};

/** Crawl requests in flight at once: enough to reach the ramp's top target. */
export const CRAWL_REQUEST_CONCURRENCY = 8;

export type CrawlRiotClientOptions = {
  apiKey: string;
  /** The process's shared ledger (`league/api/riot-budget-ledger.ts`). */
  ledger: RiotBudgetLedger;
  onBudgetRefusal?: ((refusal: BudgetRefusal) => void) | undefined;
  /** Tests only. */
  fetchFn?: FetchFunction | undefined;
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
 * tracked-match evidence capture), with every request tagged `crawl`. Its
 * limiter is separate from the tracked client's, so crawl concurrency never
 * takes a tracked slot; the ledger is shared, so the budget sees both.
 */
export function createCrawlRiotClient(
  options: CrawlRiotClientOptions,
): CrawlRiotApi {
  const client = new RiotClient({
    apiKey: options.apiKey,
    concurrency: CRAWL_REQUEST_CONCURRENCY,
    maxRetries: 0,
    reservedRealtimeSlots: 0,
    ledger: options.ledger,
    onBudgetRefusal: options.onBudgetRefusal,
    ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
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
