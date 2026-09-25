/**
 * Frequent-teammate suggestions for first-time setup.
 *
 * After a user tracks their own account, the onboarding UI can suggest friends
 * by counting who shares their team across recent matches. Teammate identity
 * comes from raw `RawMatch` participant rows (PUUID + Riot ID + team), never
 * from the report lake — lake history rows are puuid-filtered and cannot see
 * teammates.
 *
 * Suggestions are read-only: each row still goes through the verified
 * `subscription.add` flow before anything is stored.
 */

import { z } from "zod";
import {
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  PlayerAliasSchema,
  RegionSchema,
  RiotIdSchema,
  isCustomMatchPayload,
  type LeaguePuuid,
  type MatchId,
  type RawMatch,
  type Region,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { getRecentMatchIds } from "#src/league/api/match-history.ts";
import { fetchMatchData } from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { createSuggestionCache } from "#src/lib/teammates/suggestion-cache.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("teammate-suggestions");

/** Riot calls per suggestion run. One ID list call per self account plus one
 * detail fetch per match, so the detail budget is the binding limit. */
const MAX_MATCH_DETAILS = 20;
/** Suggestions shown. Small enough to decide at a glance in onboarding. */
const DEFAULT_TOP_N = 5;
const MAX_TOP_N = 10;
/** Concurrent match.get calls. A full-budget burst would turn every run into
 * 429 retries against the Riot rate limit. */
const MATCH_FETCH_CONCURRENCY = 5;
/** Freshness window for repeat suggestion runs over identical inputs. */
const SUGGESTION_CACHE_TTL_MS = 5 * 60 * 1000;

const suggestionCache = createSuggestionCache<SuggestTeammatesResult>({
  ttlMs: SUGGESTION_CACHE_TTL_MS,
});

export const SuggestTeammatesInputSchema = z.object({
  guildId: DiscordGuildIdSchema,
  alias: PlayerAliasSchema,
  matchCount: z.number().int().min(1).max(MAX_MATCH_DETAILS).default(20),
  topN: z.number().int().min(1).max(MAX_TOP_N).default(DEFAULT_TOP_N),
});

export type SuggestTeammatesInput = z.infer<typeof SuggestTeammatesInputSchema>;

export const TeammateSuggestionSchema = z.object({
  puuid: z.string(),
  gameName: z.string(),
  tagLine: z.string(),
  riotId: z.string(),
  region: RegionSchema,
  gamesTogether: z.number().int(),
  lastPlayedMs: z.number().int(),
});

export type TeammateSuggestion = z.infer<typeof TeammateSuggestionSchema>;

export const SuggestTeammatesResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ok"),
    suggestions: z.array(TeammateSuggestionSchema),
  }),
  z.object({ kind: z.literal("player-not-found") }),
  z.object({ kind: z.literal("no-matches") }),
  z.object({ kind: z.literal("riot-unavailable") }),
]);

export type SuggestTeammatesResult = z.infer<
  typeof SuggestTeammatesResultSchema
>;

type Round = { match: RawMatch; region: Region; matchId: MatchId };

type Tally = {
  gameName: string;
  tagLine: string;
  region: Region;
  gamesTogether: number;
  lastPlayedMs: number;
  lastMatchId: MatchId;
};

function isSuggestible(
  participant: RawMatch["info"]["participants"][number],
  selfTeamIds: ReadonlySet<number>,
  selfPuuids: ReadonlySet<string>,
  trackedPuuids: ReadonlySet<string>,
): boolean {
  if (!selfTeamIds.has(participant.teamId)) return false;
  if (!LeaguePuuidSchema.safeParse(participant.puuid).success) return false;
  if (selfPuuids.has(participant.puuid)) return false;
  if (trackedPuuids.has(participant.puuid)) return false;
  if (participant.riotIdGameName === undefined) return false;
  // The Add flow parses this exact text with RiotIdTextSchema (a RiotIdSchema
  // refinement), so an unusable identity must never reach the suggestion list.
  return RiotIdSchema.safeParse(
    `${participant.riotIdGameName}#${participant.riotIdTagline}`,
  ).success;
}

type TallyState = {
  perPuuid: Map<string, Tally>;
  seenInMatch: Set<string>;
};

function recordTeammate(
  state: TallyState,
  participant: RawMatch["info"]["participants"][number],
  round: Round,
): void {
  if (state.seenInMatch.has(participant.puuid)) return;
  state.seenInMatch.add(participant.puuid);
  // isSuggestible guarantees a valid Riot ID, so gameName is present.
  const gameName = participant.riotIdGameName ?? "";
  const existing = state.perPuuid.get(participant.puuid);
  if (existing === undefined) {
    state.perPuuid.set(participant.puuid, {
      gameName,
      tagLine: participant.riotIdTagline,
      region: round.region,
      gamesTogether: 1,
      lastPlayedMs: round.match.info.gameEndTimestamp,
      lastMatchId: round.matchId,
    });
    return;
  }
  existing.gamesTogether += 1;
  if (round.match.info.gameEndTimestamp >= existing.lastPlayedMs) {
    // Newest occurrence wins outright: after a Riot ID rename the older
    // gameName/tagLine/region would otherwise submit a stale, unverifiable ID.
    existing.lastPlayedMs = round.match.info.gameEndTimestamp;
    existing.lastMatchId = round.matchId;
    existing.gameName = gameName;
    existing.tagLine = participant.riotIdTagline;
    existing.region = round.region;
  }
}

/**
 * Count same-team co-occurrences across raw matches. Pure: no DB, no network.
 *
 * - Skips custom games (no stable duo signal, same rule as the import path).
 * - A match counts only when a self PUUID is on a team; only that team counts.
 * - Skips self, already-tracked PUUIDs, and rows whose Riot ID would not
 *   parse (bots and privacy-scrubbed participants carry no usable identity).
 * - Ranked by games together, then most recent shared game, then match and
 *   player identity, so truncation at topN is deterministic.
 */
export function aggregateTeammates(input: {
  rounds: Round[];
  selfPuuids: ReadonlySet<string>;
  trackedPuuids: ReadonlySet<string>;
  topN: number;
}): TeammateSuggestion[] {
  const perPuuid = new Map<string, Tally>();

  for (const round of input.rounds) {
    const { match } = round;
    if (isCustomMatchPayload(match)) continue;
    const selfTeamIds = new Set(
      match.info.participants
        .filter((participant) => input.selfPuuids.has(participant.puuid))
        .map((participant) => participant.teamId),
    );
    if (selfTeamIds.size === 0) continue;

    const state: TallyState = { perPuuid, seenInMatch: new Set<string>() };
    for (const participant of match.info.participants) {
      if (
        !isSuggestible(
          participant,
          selfTeamIds,
          input.selfPuuids,
          input.trackedPuuids,
        )
      ) {
        continue;
      }
      recordTeammate(state, participant, round);
    }
  }

  return [...perPuuid.entries()]
    .map(([puuid, row]) => ({
      puuid,
      gameName: row.gameName,
      tagLine: row.tagLine,
      riotId: `${row.gameName}#${row.tagLine}`,
      region: row.region,
      gamesTogether: row.gamesTogether,
      lastPlayedMs: row.lastPlayedMs,
      lastMatchId: row.lastMatchId,
    }))
    .toSorted(
      (left, right) =>
        right.gamesTogether - left.gamesTogether ||
        right.lastPlayedMs - left.lastPlayedMs ||
        compareStrings(left.lastMatchId, right.lastMatchId) ||
        compareStrings(left.puuid, right.puuid),
    )
    .slice(0, input.topN)
    .map((row) => ({
      puuid: row.puuid,
      gameName: row.gameName,
      tagLine: row.tagLine,
      riotId: row.riotId,
      region: row.region,
      gamesTogether: row.gamesTogether,
      lastPlayedMs: row.lastPlayedMs,
    }));
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

type SelfAccount = { puuid: LeaguePuuid; region: Region };

/**
 * Load the player's stored accounts. Stored strings are untyped at the
 * boundary, and a malformed row is a broken internal contract — parse
 * strictly and fail the request rather than suggesting from partial data.
 * Returns null when the alias is not tracked in this guild.
 */
async function loadSelfAccounts(
  guildId: string,
  alias: string,
): Promise<SelfAccount[] | null> {
  const player = await prisma.player.findUnique({
    where: { serverId_alias: { serverId: guildId, alias } },
    include: {
      accounts: {
        select: { puuid: true, region: true },
        orderBy: { id: "asc" },
      },
    },
  });
  if (player === null) return null;

  return player.accounts.map((account) => ({
    puuid: LeaguePuuidSchema.parse(account.puuid),
    region: RegionSchema.parse(account.region),
  }));
}

/**
 * Recent match IDs across the self accounts, round-robin interleaved so no
 * account starves the others, capped at the run budget. Returns undefined
 * when Riot is unreachable.
 */
async function collectMatchRounds(
  accounts: SelfAccount[],
  alias: string,
  matchCount: number,
): Promise<{ matchId: MatchId; region: Region }[] | undefined> {
  // The shared matchCount budget is split across accounts so multi-account
  // players stay within a single run's Riot cost.
  const idsPerAccount = Math.max(1, Math.ceil(matchCount / accounts.length));
  const idLists = await Promise.all(
    accounts.map((account) =>
      getRecentMatchIds(
        {
          alias,
          league: {
            leagueAccount: { puuid: account.puuid, region: account.region },
          },
        },
        idsPerAccount,
      ),
    ),
  );
  if (idLists.every((ids) => ids === undefined)) return undefined;

  const queues = accounts.map((account, index) => ({
    ids: [...(idLists[index] ?? [])],
    region: account.region,
  }));
  const interleaved: { matchId: MatchId; region: Region }[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const queue of queues) {
      const matchId = queue.ids.shift();
      if (matchId === undefined) continue;
      progressed = true;
      interleaved.push({ matchId, region: queue.region });
    }
  }
  const seen = new Set<string>();
  return interleaved
    .filter((round) => {
      if (seen.has(round.matchId)) return false;
      seen.add(round.matchId);
      return true;
    })
    .slice(0, matchCount);
}

async function fetchRoundMatches(
  rounds: { matchId: MatchId; region: Region }[],
): Promise<Round[]> {
  const fetched: Round[] = [];
  for (let index = 0; index < rounds.length; index += MATCH_FETCH_CONCURRENCY) {
    const batch = rounds.slice(index, index + MATCH_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (round) => ({
        matchId: round.matchId,
        region: round.region,
        match: await fetchMatchData(round.matchId, round.region),
      })),
    );
    for (const result of results) {
      if (result.match !== undefined) {
        fetched.push({
          match: result.match,
          region: result.region,
          matchId: result.matchId,
        });
      }
    }
  }
  return fetched;
}

/**
 * Suggest frequent teammates for a tracked player alias in a guild.
 *
 * Reads the player's stored accounts (never trusts a client PUUID), pulls
 * recent match IDs per account within a shared detail budget, fetches each
 * match live, and aggregates same-team co-occurrences excluding PUUIDs the
 * guild already tracks.
 */
export async function suggestTeammates(
  rawInput: SuggestTeammatesInput,
): Promise<SuggestTeammatesResult> {
  const input = SuggestTeammatesInputSchema.parse(rawInput);
  // Repeat runs (reloads, manual-add refetches) share one cached Riot
  // workload per exact input; concurrent callers share one in-flight fetch.
  return suggestionCache.getOrFetch(
    [input.guildId, input.alias, input.matchCount, input.topN].join("\n"),
    () => runSuggestion(input),
  );
}

async function runSuggestion(
  input: SuggestTeammatesInput,
): Promise<SuggestTeammatesResult> {
  const selfAccounts = await loadSelfAccounts(input.guildId, input.alias);
  if (selfAccounts === null) return { kind: "player-not-found" };
  if (selfAccounts.length === 0) return { kind: "no-matches" };
  const selfPuuids = new Set(selfAccounts.map((account) => account.puuid));

  const trackedRows = await prisma.account.findMany({
    where: { serverId: input.guildId },
    select: { puuid: true },
  });
  const trackedPuuids = new Set(trackedRows.map((row) => row.puuid));

  // History-list calls are part of the shared budget too: without a cap, one
  // list call per account lets a many-account player blow past matchCount
  // before any detail fetch. Exclusion still uses every self PUUID.
  const budgetedAccounts = selfAccounts.slice(0, input.matchCount);
  const rounds = await collectMatchRounds(
    budgetedAccounts,
    input.alias,
    input.matchCount,
  );
  if (rounds === undefined) {
    logger.warn(
      `[teammates] Riot unavailable for suggestion run: ${input.alias}`,
    );
    return { kind: "riot-unavailable" };
  }
  if (rounds.length === 0) return { kind: "no-matches" };

  const fetched = await fetchRoundMatches(rounds);
  if (fetched.length === 0) {
    logger.warn(`[teammates] No match details fetched for: ${input.alias}`);
    return { kind: "riot-unavailable" };
  }

  const suggestions = aggregateTeammates({
    rounds: fetched,
    selfPuuids,
    trackedPuuids,
    topN: input.topN,
  });
  return { kind: "ok", suggestions };
}
