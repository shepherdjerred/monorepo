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
  RiotHttpError,
  RiotTransportError,
} from "#src/league/api/client/errors.ts";
import { parseRateLimitType } from "#src/league/api/client/rate-limit-headers.ts";
import {
  crawlBudgetRefusalsTotal,
  crawlFrontierSize,
  crawlMatchesCrawledTotal,
  crawlRiot429Total,
  crawlTicksTotal,
} from "#src/metrics/crawl.ts";
import {
  CRAWL_MATCH_IDS_PER_QUEUE,
  CRAWL_MAX_DEPTH,
  CRAWL_PLAYERS_PER_TICK,
  CRAWL_QUEUE_IDS,
  CRAWL_TICK_DEADLINE_MS,
  crawlLookbackStart,
  crawlMatchesPerTick,
  shouldSampleTimeline,
  utcDayKey,
  utcDayStart,
} from "./crawl-config.ts";
import type { CrawlRiotApi } from "./crawl-riot-client.ts";
import {
  isCrawlableMatch,
  parseCrawlMatchEnvelope,
  reduceTimeline,
  type CrawlRecord,
} from "./crawl-records.ts";
import { encodeSegment } from "./crawl-segment.ts";
import { platformOfMatchId, seedFromTrackedMatches } from "./crawl-seed.ts";
import type {
  CommitInput,
  CrawlObjectStore,
  CrawlStore,
  FrontierPlayer,
  NewFrontierPlayer,
  StoredMatchRow,
} from "./crawl-store.ts";

const logger = createLogger("participant-crawl");

export type CrawlTickStatus =
  | "disabled"
  | "budget-exhausted"
  | "completed"
  | "rate-limited"
  | "upstream-error";

export type CrawlTickResult = {
  status: CrawlTickStatus;
  seededObservations: number;
  admittedPlayers: number;
  playersVisited: number;
  matchesStored: number;
  segmentsWritten: number;
};

export type CrawlDeps = {
  store: CrawlStore;
  riot: CrawlRiotApi;
  objects: CrawlObjectStore;
  now: () => Date;
  enabled: () => boolean;
  dailyMatchBudget: () => number;
  /** Called between Riot calls so the activity can heartbeat. */
  heartbeat?: (() => void) | undefined;
};

export function idleTickResult(status: CrawlTickStatus): CrawlTickResult {
  return {
    status,
    seededObservations: 0,
    admittedPlayers: 0,
    playersVisited: 0,
    matchesStored: 0,
    segmentsWritten: 0,
  };
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

type TickState = {
  rateLimited: boolean;
  upstreamError: boolean;
  deadline: number;
};

function shouldStop(deps: CrawlDeps, state: TickState): boolean {
  return (
    state.rateLimited ||
    state.upstreamError ||
    deps.now().getTime() >= state.deadline
  );
}

/** Record an expected Riot failure on the tick; anything else is a bug and rethrows. */
function absorbRiotFailure(state: TickState, error: unknown): void {
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

type StoredMatch = { record: CrawlRecord; row: StoredMatchRow };

type TickCollection = {
  stored: StoredMatch[];
  children: NewFrontierPlayer[];
  visits: CommitInput["visits"];
};

/**
 * One crawl tick: seed from tracked matches, visit a few eligible players,
 * fetch their unseen matches within the day's budget, and commit raw segments
 * and frontier state together. Expected external failures (a 429, an upstream
 * outage) end the tick quietly; a malformed Riot payload or a database error
 * fails loudly.
 */
export async function runCrawlTick(deps: CrawlDeps): Promise<CrawlTickResult> {
  const start = deps.now();
  if (!deps.enabled()) {
    crawlTicksTotal.inc({ status: "disabled" });
    return idleTickResult("disabled");
  }
  const dailyBudget = deps.dailyMatchBudget();
  const crawledToday = await deps.store.matchesCrawledSince(utcDayStart(start));
  const remaining = dailyBudget - crawledToday;
  if (remaining <= 0) {
    crawlBudgetRefusalsTotal.inc({ reason: "daily-match-budget" });
    crawlTicksTotal.inc({ status: "budget-exhausted" });
    return idleTickResult("budget-exhausted");
  }

  const seed = await seedFromTrackedMatches(deps, start);
  const state: TickState = {
    rateLimited: false,
    upstreamError: false,
    deadline: start.getTime() + CRAWL_TICK_DEADLINE_MS,
  };
  const collected = await collectFromPlayers(deps, state, {
    now: start,
    matchCap: Math.min(remaining, crawlMatchesPerTick(dailyBudget)),
  });
  const segments = await writeAndCommit(deps, start, collected);
  await recordTickMetrics(deps, collected.stored);

  const status: CrawlTickStatus = state.rateLimited
    ? "rate-limited"
    : state.upstreamError
      ? "upstream-error"
      : "completed";
  crawlTicksTotal.inc({ status });
  return {
    status,
    seededObservations: seed.observations,
    admittedPlayers: seed.admitted,
    playersVisited: collected.visits.length,
    matchesStored: collected.stored.length,
    segmentsWritten: segments,
  };
}

async function collectFromPlayers(
  deps: CrawlDeps,
  state: TickState,
  context: { now: Date; matchCap: number },
): Promise<TickCollection> {
  const players = await deps.store.claimEligible(
    context.now,
    CRAWL_PLAYERS_PER_TICK,
  );
  const collected: TickCollection = { stored: [], children: [], visits: [] };
  const seenMatchIds = new Set<RiotMatchId>();
  for (const player of players) {
    if (collected.stored.length >= context.matchCap || shouldStop(deps, state))
      break;
    const visit = await visitPlayer(deps, state, player, {
      now: context.now,
      room: context.matchCap - collected.stored.length,
      seenMatchIds,
    });
    collected.stored.push(...visit.stored);
    collected.children.push(...visit.children);
    if (visit.complete) {
      collected.visits.push({ puuid: player.puuid, rank: visit.rank });
    }
  }
  return collected;
}

/** Write one segment per route, then commit everything atomically; returns segments written. */
async function writeAndCommit(
  deps: CrawlDeps,
  now: Date,
  collected: TickCollection,
): Promise<number> {
  const byRoute = Map.groupBy(
    collected.stored,
    (entry) => entry.record.platform,
  );
  const segments: CommitInput["segments"] = [];
  for (const [route, entries] of byRoute) {
    const segment = encodeSegment({
      route: route.toLowerCase(),
      dt: utcDayKey(now),
      records: entries.map((entry) => entry.record),
    });
    await deps.objects.putSegment(segment);
    segments.push({ segment, matches: entries.map((entry) => entry.row) });
  }
  await deps.store.commit({
    now,
    segments,
    visits: collected.visits,
    children: collected.children.filter(
      (child) => child.depth <= CRAWL_MAX_DEPTH,
    ),
  });
  return segments.length;
}

async function recordTickMetrics(
  deps: CrawlDeps,
  stored: readonly StoredMatch[],
): Promise<void> {
  for (const { row } of stored) {
    crawlMatchesCrawledTotal.inc({
      timeline: row.timelineSampled ? "sampled" : "none",
    });
  }
  const sizes = await deps.store.frontierSizeByDepth();
  for (let depth = 0; depth <= CRAWL_MAX_DEPTH; depth += 1) {
    crawlFrontierSize.set({ depth: depth.toString() }, sizes[depth] ?? 0);
  }
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
  deps: CrawlDeps,
  state: TickState,
  puuid: LeaguePuuid,
  platform: PlatformRoute,
): Promise<Bracket | undefined> {
  try {
    deps.heartbeat?.();
    return bracketFromLeagueEntries(
      await deps.riot.leagueEntries(puuid, platform),
    );
  } catch (error) {
    if (isNotFound(error)) return null;
    absorbRiotFailure(state, error);
    return undefined;
  }
}

/** Recent match ids across the crawled queues, `undefined` when the tick must stop. */
async function listMatchIds(
  deps: CrawlDeps,
  state: TickState,
  player: { puuid: LeaguePuuid; platform: PlatformRoute; now: Date },
): Promise<Set<RiotMatchId> | undefined> {
  const regional = platformToRegionalRoute(player.platform);
  const startTime = Math.floor(crawlLookbackStart(player.now).getTime() / 1000);
  const found = new Set<RiotMatchId>();
  for (const queue of CRAWL_QUEUE_IDS) {
    if (shouldStop(deps, state)) return undefined;
    try {
      deps.heartbeat?.();
      const ids = await deps.riot.matchIds(player.puuid, regional, {
        queue,
        startTime,
        count: CRAWL_MATCH_IDS_PER_QUEUE,
      });
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
  deps: CrawlDeps,
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
  for (const matchId of unknown) {
    if (visit.stored.length >= context.room || shouldStop(deps, state)) {
      return visit;
    }
    const outcome = await crawlMatch(deps, state, {
      matchId,
      puuid: player.puuid,
      rank,
      depth: player.depth,
      now: context.now,
    });
    if (outcome === "stop") return visit;
    context.seenMatchIds.add(matchId);
    if (outcome === "skipped") continue;
    visit.stored.push(outcome.stored);
    visit.children.push(...outcome.children);
  }
  return { ...visit, complete: true };
}

type MatchOutcome =
  "skipped" | "stop" | { stored: StoredMatch; children: NewFrontierPlayer[] };

/** The reduced timeline for a sampled match, `null` when none exists, `undefined` to stop. */
async function sampledTimeline(
  deps: CrawlDeps,
  state: TickState,
  matchId: RiotMatchId,
  platform: PlatformRoute,
): Promise<CrawlRecord["timeline"] | undefined> {
  if (!shouldSampleTimeline(matchId)) return null;
  try {
    deps.heartbeat?.();
    return reduceTimeline(
      await deps.riot.timeline(matchId, platformToRegionalRoute(platform)),
    );
  } catch (error) {
    if (isNotFound(error)) return null;
    absorbRiotFailure(state, error);
    return undefined;
  }
}

async function crawlMatch(
  deps: CrawlDeps,
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
    deps.heartbeat?.();
    rawMatch = await deps.riot.match(
      input.matchId,
      platformToRegionalRoute(platform),
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
