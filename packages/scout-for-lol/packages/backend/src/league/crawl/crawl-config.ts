import { createHash } from "node:crypto";

/**
 * The participant crawl's fixed rules. Operational knobs (whether it runs, how
 * many matches a day) are the typed dynamic configuration in
 * `config/dynamic.ts`; everything here is part of the crawl's contract.
 */

/** Ranked solo, ranked flex and normal draft pick. */
export const CRAWL_QUEUE_IDS = [420, 440, 400] as const;
export type CrawlQueueId = (typeof CRAWL_QUEUE_IDS)[number];

/** Summoner's Rift. */
export const CRAWL_MAP_ID = 11;

/** Only games this recent are stored. */
export const CRAWL_LOOKBACK_DAYS = 28;

/** A visited player is not visited again for this long (also a DB CHECK). */
export const CRAWL_COOLDOWN_DAYS = 7;

/** Frontier depth: 0 is a tracked match's participant; at most 2 (DB CHECK). */
export const CRAWL_MAX_DEPTH = 2;

/** Share of matches whose timeline is fetched, chosen by match id hash. */
export const CRAWL_TIMELINE_PERCENT = 20;

/** Match ids requested per player per queue. */
export const CRAWL_MATCH_IDS_PER_QUEUE = 20;

/** Tracked-match observations read per seeding pass. */
export const CRAWL_SEED_OBSERVATIONS_PER_TICK = 25;

/** Players visited per tick at most. */
export const CRAWL_PLAYERS_PER_TICK = 4;

/** A tick stops starting new work after this long. */
export const CRAWL_TICK_DEADLINE_MS = 4 * 60_000;

const DAY_MS = 86_400_000;
const MINUTES_PER_DAY = 1440;

/** A tick spends about four ticks' worth of the daily budget, never fewer than 5 matches. */
export function crawlMatchesPerTick(dailyBudget: number): number {
  return Math.max(5, Math.ceil(dailyBudget / MINUTES_PER_DAY) * 4);
}

export function crawlLookbackStart(now: Date): Date {
  return new Date(now.getTime() - CRAWL_LOOKBACK_DAYS * DAY_MS);
}

export function crawlCooldownEnd(visitedAt: Date): Date {
  return new Date(visitedAt.getTime() + CRAWL_COOLDOWN_DAYS * DAY_MS);
}

/** The start of the UTC day containing `now`. */
export function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** `YYYY-MM-DD` for the UTC day containing `now`. */
export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** A deterministic 20% of matches get a timeline; the same id always answers alike. */
export function shouldSampleTimeline(matchId: string): boolean {
  const digest = createHash("sha256").update(matchId).digest();
  return digest.readUInt32BE(0) % 100 < CRAWL_TIMELINE_PERCENT;
}

/** The SHA-256 hex of a PUUID: what `ErasedPuuid` stores. */
export function puuidHash(puuid: string): string {
  return createHash("sha256").update(puuid).digest("hex");
}
