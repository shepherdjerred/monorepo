import type {
  LeaguePuuid,
  PlatformRoute,
  RegionalRoute,
  RiotMatchId,
} from "@scout-for-lol/data";
import {
  RiotBudgetLedger,
  type RiotBudgetMode,
} from "#src/league/api/client/rate-budget.ts";
import type {
  BudgetRefusal,
  RateLimitedRequestOptions,
} from "#src/league/api/client/rate-limiter.ts";
import {
  RiotClient,
  type FetchFunction,
} from "#src/league/api/client/riot-client.ts";

/**
 * Every call the live roster's recent-form pass makes is `backfill`.
 *
 * Not `realtime`: the game-start notification and spectator reads own that
 * class, and nothing here is worth delaying them. Not `interactive`: that
 * class is for a person waiting on the answer, and no one is waiting on this.
 * The page reads PostgreSQL and shows whatever has landed. `backfill` still
 * sits above `crawl` in the ledger (ceiling 0.6 of each window against the
 * crawl's quarter), so a crawl running at its utilisation target yields to a
 * lobby's worth of reads instead of the other way round, and a burst of about
 * sixty calls per game cannot starve a human-facing Explore request.
 *
 * No retries: a 429 or an upstream error ends the pass, which the Activity's
 * retry policy resumes after a backoff, rather than the limiter hammering a
 * window that just told us it is full.
 */
const LIVE_FORM_REQUEST: RateLimitedRequestOptions = {
  priority: "backfill",
  maxRetries: 0,
  retryUpstreamErrors: false,
};

/** The pass ran out of time waiting for the budget ledger to admit a call. */
export class LiveFormBudgetDeferred extends Error {
  constructor() {
    super("The Riot budget ledger did not admit a live roster read in time");
    this.name = "LiveFormBudgetDeferred";
  }
}

/** The three Riot reads one stranger's recent form needs. */
export type LiveFormRiotApi = {
  rankedMatchIds: (
    puuid: LeaguePuuid,
    regionalRoute: RegionalRoute,
    count: number,
  ) => Promise<RiotMatchId[]>;
  match: (
    matchId: RiotMatchId,
    regionalRoute: RegionalRoute,
  ) => Promise<unknown>;
  leagueEntries: (
    puuid: LeaguePuuid,
    platform: PlatformRoute,
  ) => Promise<unknown>;
};

/**
 * What this process has learned about the key's usage. Riot reports the whole
 * key's count on every response, so one ledger per process, shared by every
 * pass, keeps the budget honest between games.
 */
const processLedger = new RiotBudgetLedger({ clock: Date.now });

export type LiveFormRiotOptions = {
  apiKey: string;
  budgetMode: () => RiotBudgetMode;
  /** Ends the pass: calls waiting on the ledger give up, and none is sent. */
  signal: AbortSignal;
  onBudgetRefusal?: ((refusal: BudgetRefusal) => void) | undefined;
  /** Tests only. */
  fetchFn?: FetchFunction | undefined;
  /** Tests only. */
  ledger?: RiotBudgetLedger | undefined;
};

/**
 * The live roster's own `RiotClient`, one per pass.
 *
 * Separate from the shared client for the reason the crawl's is: the shared
 * client captures every response it receives as match evidence (`onPayload`),
 * and a stranger's match must never be stored outside the normal paths. This
 * client has no capture hook, so what a game returns is read, reduced to a
 * handful of numbers and dropped.
 *
 * In `enforce` mode the limiter holds a refused request until the ledger
 * admits it. The pass signal bounds that wait: a call still waiting when the
 * signal aborts rejects with {@link LiveFormBudgetDeferred}, and the guarded
 * `fetch` never sends it once admitted late.
 */
export function createLiveFormRiotApi(
  options: LiveFormRiotOptions,
): LiveFormRiotApi {
  const send = options.fetchFn ?? fetch;
  const client = new RiotClient({
    apiKey: options.apiKey,
    concurrency: 2,
    maxRetries: 0,
    reservedRealtimeSlots: 1,
    budgetMode: options.budgetMode,
    onBudgetRefusal: options.onBudgetRefusal,
    ledger: options.ledger ?? processLedger,
    fetchFn: (input, init) =>
      options.signal.aborted
        ? Promise.reject(new LiveFormBudgetDeferred())
        : send(input, init),
  });

  /**
   * Race the call against the end of the pass. The race observes `work` either
   * way, so a call that loses is never left to reject unobserved.
   */
  async function bounded<T>(work: Promise<T>): Promise<T> {
    let onAbort: (() => void) | undefined;
    const passEnded = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        reject(new LiveFormBudgetDeferred());
      };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([work, passEnded]);
    } finally {
      if (onAbort !== undefined) {
        options.signal.removeEventListener("abort", onAbort);
      }
    }
  }

  return {
    rankedMatchIds: (puuid, regionalRoute, count) =>
      bounded(
        client.match.list(
          puuid,
          regionalRoute,
          { type: "ranked", count },
          LIVE_FORM_REQUEST,
        ),
      ),
    match: (matchId, regionalRoute) =>
      bounded(client.match.get(matchId, regionalRoute, LIVE_FORM_REQUEST)),
    leagueEntries: (puuid, platform) =>
      bounded(client.league.byPuuid(puuid, platform, LIVE_FORM_REQUEST)),
  };
}
