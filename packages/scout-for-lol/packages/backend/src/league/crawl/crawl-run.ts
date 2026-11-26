import type { RiotMatchId } from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import {
  crawlBudgetRefusalsTotal,
  crawlFrontierSize,
  crawlMatchesCrawledTotal,
  crawlTickMatchAllowance as crawlTickMatchAllowanceGauge,
  crawlTicksTotal,
} from "#src/metrics/crawl.ts";
import {
  CRAWL_MAX_DEPTH,
  CRAWL_PLAYERS_PER_BATCH,
  CRAWL_TICK_DEADLINE_MS,
  crawlTickMatchAllowance,
  utcDayKey,
  utcDayStart,
} from "./crawl-config.ts";
import type { CrawlRiotApi } from "./crawl-riot-client.ts";
import { encodeSegment, type EncodedSegment } from "./crawl-segment.ts";
import { seedFromTrackedMatches } from "./crawl-seed.ts";
import {
  CrawlErasureFenceError,
  type CommitInput,
  type CrawlObjectStore,
  type CrawlStore,
} from "./crawl-store.ts";
import {
  collectBatch,
  shouldStop,
  type BatchCollection,
  type StoredMatch,
  type TickState,
} from "./crawl-visit.ts";

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
  /**
   * Hands a committed segment to the report lake's crawl inbox. Called only
   * after the commit, so the inbox never holds a segment PostgreSQL does not
   * list; a failure is logged and repaired by the nightly rebuild, which
   * re-derives any day whose ledger lacks a committed segment.
   */
  lakeInbox: (segment: EncodedSegment) => Promise<void>;
  now: () => Date;
  /** Waits out a short Riot budget refusal. */
  sleep: (milliseconds: number) => Promise<void>;
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

/**
 * One crawl tick: seed from tracked matches, then claim and visit eligible
 * players in batches, committing raw segments and frontier state per batch,
 * until the Riot budget refuses for longer than the tick can wait, the
 * deadline passes, the frontier runs dry, or the tick's paced share of the
 * daily budget is stored. Expected external failures (a 429, an upstream
 * outage) end the tick quietly; a malformed Riot payload or a database error
 * fails loudly.
 */
export async function runCrawlTick(deps: CrawlDeps): Promise<CrawlTickResult> {
  const start = deps.now();
  if (!deps.enabled()) {
    crawlTicksTotal.inc({ status: "disabled" });
    return idleTickResult("disabled");
  }
  const crawledToday = await deps.store.matchesCrawledSince(utcDayStart(start));
  const remaining = deps.dailyMatchBudget() - crawledToday;
  if (remaining <= 0) {
    crawlBudgetRefusalsTotal.inc({ reason: "daily-match-budget" });
    crawlTicksTotal.inc({ status: "budget-exhausted" });
    return idleTickResult("budget-exhausted");
  }
  const allowance = crawlTickMatchAllowance(remaining, start);
  crawlTickMatchAllowanceGauge.set(allowance);

  // Read before any erased-player check, so the commit can tell whether an
  // erasure landed after the checks this batch makes.
  let erasureMark = await deps.store.erasureMark();
  const seed = await seedFromTrackedMatches(deps, start);
  const state: TickState = {
    rateLimited: false,
    upstreamError: false,
    headroomExhausted: false,
    deadline: start.getTime() + CRAWL_TICK_DEADLINE_MS,
  };
  const seenMatchIds = new Set<RiotMatchId>();
  const totals = { visits: 0, stored: 0, segments: 0 };
  while (totals.stored < allowance && !shouldStop(deps, state)) {
    const players = await deps.store.claimEligible(
      start,
      CRAWL_PLAYERS_PER_BATCH,
    );
    if (players.length === 0) break;
    const collected = await collectBatch(deps, state, {
      now: start,
      players,
      matchCap: allowance - totals.stored,
      seenMatchIds,
    });
    totals.segments += await writeAndCommit(
      deps,
      start,
      erasureMark,
      collected,
    );
    totals.stored += collected.stored.length;
    totals.visits += collected.visits.length;
    recordMatchMetrics(collected.stored);
    // A batch that completed no visit would claim the same players again.
    if (collected.visits.length === 0) break;
    erasureMark = await deps.store.erasureMark();
  }
  await recordFrontierMetrics(deps);

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
    playersVisited: totals.visits,
    matchesStored: totals.stored,
    segmentsWritten: totals.segments,
  };
}

/** Write one segment per route, then commit everything atomically; returns segments written. */
async function writeAndCommit(
  deps: CrawlDeps,
  now: Date,
  erasureMark: number,
  collected: BatchCollection,
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
  try {
    await deps.store.commit({
      now,
      erasureMark,
      segments,
      visits: collected.visits,
      children: collected.children.filter(
        (child) => child.depth <= CRAWL_MAX_DEPTH,
      ),
    });
  } catch (error) {
    if (error instanceof CrawlErasureFenceError) {
      // The objects are already in S3 but no row names them; the erasure
      // sweep deletes them, since they may hold the newly erased player.
      await deps.store.queueObjectDeletions(
        segments.map(({ segment }) => segment.objectKey),
      );
    }
    throw error;
  }
  for (const { segment } of segments) {
    try {
      await deps.lakeInbox(segment);
    } catch (error) {
      logger.warn(
        `Crawl segment ${segment.sha256} is committed but not in the lake inbox; the nightly rebuild will fold it`,
        { error },
      );
    }
  }
  return segments.length;
}

function recordMatchMetrics(stored: readonly StoredMatch[]): void {
  for (const { row } of stored) {
    crawlMatchesCrawledTotal.inc({
      timeline: row.timelineSampled ? "sampled" : "none",
    });
  }
}

async function recordFrontierMetrics(deps: CrawlDeps): Promise<void> {
  const sizes = await deps.store.frontierSizeByDepth();
  for (let depth = 0; depth <= CRAWL_MAX_DEPTH; depth += 1) {
    crawlFrontierSize.set({ depth: depth.toString() }, sizes[depth] ?? 0);
  }
}
