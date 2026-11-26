import {
  LeaguePuuidSchema,
  RawSummonerLeagueListSchema,
  StandardSummonerLeagueSchema,
  platformToRegionalRoute,
  type LeaguePuuid,
  type PlatformRoute,
  type RiotMatchId,
} from "@scout-for-lol/data";
import { PlatformRouteSchema } from "@scout-for-lol/domain/identity/routes.ts";
import { createLogger } from "#src/logger.ts";
import {
  RiotBudgetRefusedError,
  RiotHttpError,
  RiotTransportError,
} from "#src/league/api/client/errors.ts";
import { parseRateLimitType } from "#src/league/api/client/rate-limit-headers.ts";
import { crawlRiot429Total } from "#src/metrics/crawl.ts";
import {
  CRAWL_MATCH_IDS_PER_QUEUE,
  CRAWL_MATCHES_PER_COMMIT,
  CRAWL_MAX_ADMISSION_WAIT_MS,
  CRAWL_MAX_DEPTH,
  CRAWL_QUEUE_IDS,
  crawlLookbackStart,
  shouldSampleTimeline,
} from "./crawl-config.ts";
import {
  CRAWL_REQUEST_CONCURRENCY,
  type CrawlRiotApi,
} from "./crawl-riot-client.ts";
import {
  isCrawlableMatch,
  parseCrawlMatchEnvelope,
  reduceTimeline,
  type CrawlRecord,
} from "./crawl-records.ts";
import { platformOfMatchId } from "./crawl-seed.ts";
import type {
  CommitInput,
  CrawlStore,
  FrontierPlayer,
  NewFrontierPlayer,
  StoredMatchRow,
} from "./crawl-store.ts";

/**
 * Visiting claimed players: their rank, their recent match ids and their
 * unseen matches, fetched with bounded concurrency. Every Riot call goes
 * through `admitted`, which waits out a short budget refusal and ends the tick
 * on a long one.
 */

const logger = createLogger("participant-crawl");

/** What a visit needs from the tick's dependencies. */
export type VisitDeps = {
  store: CrawlStore;
  riot: CrawlRiotApi;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  heartbeat?: (() => void) | undefined;
};

export type TickState = {
  rateLimited: boolean;
  upstreamError: boolean;
  /** The Riot budget refused a request for longer than the tick can wait. */
  headroomExhausted: boolean;
  deadline: number;
};

export function shouldStop(deps: VisitDeps, state: TickState): boolean {
  return (
    state.rateLimited ||
    state.upstreamError ||
    state.headroomExhausted ||
    deps.now().getTime() >= state.deadline
  );
}

type Bracket = { tier: string; division: string } | null;

/** Solo/duo first, then flex; unranked players have no bracket. */
export function bracketFromLeagueEntries(raw: unknown): Bracket {
  const entries = RawSummonerLeagueListSchema.parse(raw);
  for (const queueType of ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"]) {
    const entry = entries.find(
      (candidate) => candidate.queueType === queueType,
    );
    if (entry === undefined) continue;
    const standard = StandardSummonerLeagueSchema.parse(entry);
    return { tier: standard.tier, division: standard.rank };
  }
  return null;
}

/** Whether a Riot response means "this one thing does not exist", not "stop". */
function isNotFound(error: unknown): boolean {
  return error instanceof RiotHttpError && error.status === 404;
}

/** A Riot outage or key problem: expected at the boundary, so the tick ends quietly. */
function isUpstreamFailure(error: unknown): boolean {
  return (
    error instanceof RiotTransportError ||
    (error instanceof RiotHttpError &&
      (error.status >= 500 || error.status === 403))
  );
}

/** Record an expected Riot failure on the tick; anything else is a bug and rethrows. */
function absorbRiotFailure(state: TickState, error: unknown): void {
  if (error instanceof RiotBudgetRefusedError) {
    state.headroomExhausted = true;
    return;
  }
  if (error instanceof RiotHttpError && error.status === 429) {
    crawlRiot429Total.inc({ limit_type: parseRateLimitType(error.headers) });
    state.rateLimited = true;
    return;
  }
  if (isUpstreamFailure(error)) {
    logger.warn("Crawl Riot call failed; ending the tick", { error });
    state.upstreamError = true;
    return;
  }
  throw error;
}

/**
 * One crawl Riot call under the budget. A refusal the tick can wait out
 * (short, and ending before the deadline) is slept through and retried;
 * a longer one is rethrown, and `absorbRiotFailure` ends the tick.
 */
async function admitted<T>(
  deps: VisitDeps,
  state: TickState,
  call: () => Promise<T>,
): Promise<T> {
  for (;;) {
    deps.heartbeat?.();
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof RiotBudgetRefusedError)) throw error;
      const resumeAt = deps.now().getTime() + error.waitMs;
      if (
        error.waitMs > CRAWL_MAX_ADMISSION_WAIT_MS ||
        resumeAt >= state.deadline ||
        shouldStop(deps, state)
      ) {
        throw error;
      }
      await deps.sleep(error.waitMs);
    }
  }
}

export type StoredMatch = { record: CrawlRecord; row: StoredMatchRow };

export type BatchCollection = {
  stored: StoredMatch[];
  children: NewFrontierPlayer[];
  visits: CommitInput["visits"];
};

/**
 * Visit claimed players in order until the batch holds a commit's worth of
 * matches, the tick's paced allowance (`matchCap`) is reached, or the tick
 * must stop.
 */
export async function collectBatch(
  deps: VisitDeps,
  state: TickState,
  context: {
    now: Date;
    players: readonly FrontierPlayer[];
    matchCap: number;
    seenMatchIds: Set<RiotMatchId>;
  },
): Promise<BatchCollection> {
  const collected: BatchCollection = { stored: [], children: [], visits: [] };
  for (const player of context.players) {
    if (
      collected.stored.length >= context.matchCap ||
      collected.stored.length >= CRAWL_MATCHES_PER_COMMIT ||
      shouldStop(deps, state)
    )
      break;
    const visit = await visitPlayer(deps, state, player, {
      now: context.now,
      room: context.matchCap - collected.stored.length,
      seenMatchIds: context.seenMatchIds,
    });
    collected.stored.push(...visit.stored);
    collected.children.push(...visit.children);
    if (visit.complete) {
      collected.visits.push({ puuid: player.puuid, rank: visit.rank });
    }
  }
  return collected;
}

type PlayerVisit = {
  stored: StoredMatch[];
  children: NewFrontierPlayer[];
  /** Every unseen match of this player was handled, so the cooldown may start. */
  complete: boolean;
  rank: Bracket;
};

/** The bracket from one league-v4 lookup, `undefined` when the tick must stop. */
async function lookUpRank(
  deps: VisitDeps,
  state: TickState,
  puuid: LeaguePuuid,
  platform: PlatformRoute,
): Promise<Bracket | undefined> {
  try {
    return bracketFromLeagueEntries(
      await admitted(deps, state, () =>
        deps.riot.leagueEntries(puuid, platform),
      ),
    );
  } catch (error) {
    if (isNotFound(error)) return null;
    absorbRiotFailure(state, error);
    return undefined;
  }
}

/** Recent match ids across the crawled queues, `undefined` when the tick must stop. */
async function listMatchIds(
  deps: VisitDeps,
  state: TickState,
  player: { puuid: LeaguePuuid; platform: PlatformRoute; now: Date },
): Promise<Set<RiotMatchId> | undefined> {
  const regional = platformToRegionalRoute(player.platform);
  const startTime = Math.floor(crawlLookbackStart(player.now).getTime() / 1000);
  const found = new Set<RiotMatchId>();
  for (const queue of CRAWL_QUEUE_IDS) {
    if (shouldStop(deps, state)) return undefined;
    try {
      const ids = await admitted(deps, state, () =>
        deps.riot.matchIds(player.puuid, regional, {
          queue,
          startTime,
          count: CRAWL_MATCH_IDS_PER_QUEUE,
        }),
      );
      for (const id of ids) found.add(id);
    } catch (error) {
      if (isNotFound(error)) continue;
      absorbRiotFailure(state, error);
      return undefined;
    }
  }
  return found;
}

async function visitPlayer(
  deps: VisitDeps,
  state: TickState,
  player: FrontierPlayer,
  context: { now: Date; room: number; seenMatchIds: Set<RiotMatchId> },
): Promise<PlayerVisit> {
  const platform: PlatformRoute = PlatformRouteSchema.parse(
    player.platformRoute,
  );
  const stopped: PlayerVisit = {
    stored: [],
    children: [],
    complete: false,
    rank: null,
  };
  const rank = await lookUpRank(deps, state, player.puuid, platform);
  if (rank === undefined) return stopped;
  const found = await listMatchIds(deps, state, {
    puuid: player.puuid,
    platform,
    now: context.now,
  });
  if (found === undefined) return stopped;

  const notStored = await deps.store.unknownMatchIds([...found]);
  const unknown = notStored.filter((id) => !context.seenMatchIds.has(id));
  const visit: PlayerVisit = { ...stopped, rank };
  let next = 0;
  // Waves of up to CRAWL_REQUEST_CONCURRENCY matches, never more than the
  // room left, kept in match-list order so a visit's output is deterministic.
  while (next < unknown.length) {
    const room = context.room - visit.stored.length;
    if (room <= 0 || shouldStop(deps, state)) return visit;
    const wave = unknown.slice(
      next,
      next + Math.min(room, CRAWL_REQUEST_CONCURRENCY),
    );
    next += wave.length;
    const outcomes = await Promise.all(
      wave.map(async (matchId) => ({
        matchId,
        outcome: await crawlMatch(deps, state, {
          matchId,
          puuid: player.puuid,
          rank,
          depth: player.depth,
          now: context.now,
        }),
      })),
    );
    for (const { matchId, outcome } of outcomes) {
      if (outcome === "stop") continue;
      context.seenMatchIds.add(matchId);
      if (outcome === "skipped") continue;
      visit.stored.push(outcome.stored);
      visit.children.push(...outcome.children);
    }
    if (outcomes.some(({ outcome }) => outcome === "stop")) return visit;
  }
  return { ...visit, complete: true };
}

type MatchOutcome =
  "skipped" | "stop" | { stored: StoredMatch; children: NewFrontierPlayer[] };

/** The reduced timeline for a sampled match, `null` when none exists, `undefined` to stop. */
async function sampledTimeline(
  deps: VisitDeps,
  state: TickState,
  matchId: RiotMatchId,
  platform: PlatformRoute,
): Promise<CrawlRecord["timeline"] | undefined> {
  if (!shouldSampleTimeline(matchId)) return null;
  try {
    return reduceTimeline(
      await admitted(deps, state, () =>
        deps.riot.timeline(matchId, platformToRegionalRoute(platform)),
      ),
    );
  } catch (error) {
    if (isNotFound(error)) return null;
    absorbRiotFailure(state, error);
    return undefined;
  }
}

async function crawlMatch(
  deps: VisitDeps,
  state: TickState,
  input: {
    matchId: RiotMatchId;
    puuid: LeaguePuuid;
    rank: Bracket;
    depth: number;
    now: Date;
  },
): Promise<MatchOutcome> {
  const platformRoute = platformOfMatchId(input.matchId);
  const platform = PlatformRouteSchema.parse(platformRoute);
  let rawMatch: unknown;
  try {
    rawMatch = await admitted(deps, state, () =>
      deps.riot.match(input.matchId, platformToRegionalRoute(platform)),
    );
  } catch (error) {
    if (isNotFound(error)) return "skipped";
    absorbRiotFailure(state, error);
    return "stop";
  }
  const envelope = parseCrawlMatchEnvelope(rawMatch);
  const gameCreatedAt = new Date(envelope.info.gameCreation);
  if (
    !isCrawlableMatch(envelope) ||
    gameCreatedAt.getTime() < crawlLookbackStart(input.now).getTime()
  ) {
    return "skipped";
  }
  const participants = envelope.info.participants.map((p) => p.puuid);
  // A match that includes an erased player is never stored.
  const erased = await deps.store.erasedAmong(participants);
  if (erased.size > 0) return "skipped";

  const timeline = await sampledTimeline(deps, state, input.matchId, platform);
  if (timeline === undefined) return "stop";

  const record: CrawlRecord = {
    v: 1,
    matchId: input.matchId,
    platform: platformRoute,
    crawledAt: input.now.toISOString(),
    depth: input.depth,
    visited: {
      puuid: input.puuid,
      tier: input.rank?.tier ?? null,
      division: input.rank?.division ?? null,
    },
    match: rawMatch,
    timeline,
  };
  const row: StoredMatchRow = {
    riotMatchId: input.matchId,
    platformRoute,
    queueId: envelope.info.queueId,
    gameCreatedAt,
    depth: input.depth,
    visitedPuuid: input.puuid,
    timelineSampled: timeline !== null,
  };
  const childDepth = input.depth + 1;
  const children: NewFrontierPlayer[] =
    childDepth > CRAWL_MAX_DEPTH
      ? []
      : participants.map((puuid) => ({
          puuid: LeaguePuuidSchema.parse(puuid),
          platformRoute,
          depth: childDepth,
          seedMatchId: input.matchId,
        }));
  return { stored: { record, row }, children };
}
