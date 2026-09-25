import { tool } from "ai";
import { z } from "zod";
import {
  LeaguePuuidSchema,
  getChampionList,
  type DiscordAccountId,
  type Region,
} from "@scout-for-lol/data";
import {
  RankedHistoryTargetSchema,
  resolveRiotPlayerTarget,
} from "#src/explore/tools/riot-history-tools.ts";
import { fetchCurrentRanks } from "#src/league/initial-history/riot.ts";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildMatchesSource,
  buildTimelineCoverageSource,
  listParam,
  resolveLakeFiles,
  scalarParam,
} from "#src/reports/duckdb/lake.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";
import {
  getChampionMasterySnapshot,
  topChampionMastery,
} from "#src/league/champion-mastery/snapshots.ts";
import { readLocalMasterySnapshot } from "#src/scout-client/player-snapshots.ts";

const LakeCountSchema = z.union([z.bigint(), z.number()]).transform(Number);
const CoverageRowSchema = z.object({
  games: LakeCountSchema,
  first_game_ms: LakeCountSchema.nullable(),
  last_game_ms: LakeCountSchema.nullable(),
});
const TimelineCountRowSchema = z.object({ timelines: LakeCountSchema });
const MatchIdRowSchema = z.object({ match_id: z.string() });
const LOCAL_MASTERY_FRESHNESS_MS = 24 * 60 * 60 * 1000;

async function inspectCoverage(puuid: string): Promise<{
  games: number;
  timelines: number;
  firstGameAt: string | null;
  lastGameAt: string | null;
}> {
  const files = await resolveLakeFiles(resolveLakeDir());
  const matches = buildMatchesSource(files, {
    sql: "puuid = ?",
    params: [scalarParam(puuid)],
  });
  if (matches === undefined) {
    return { games: 0, timelines: 0, firstGameAt: null, lastGameAt: null };
  }
  return await withDuckDBConnection(async (session) => {
    const matchRows = await session.run(
      `SELECT COUNT(DISTINCT match_id) AS games, MIN(epoch_ms(game_creation_at)) AS first_game_ms, MAX(epoch_ms(game_creation_at)) AS last_game_ms FROM (${matches.sql})`,
      bindParams(session, matches.params),
    );
    const coverage = CoverageRowSchema.parse(matchRows[0]);
    const idRows = await session.run(
      `SELECT DISTINCT match_id FROM (${matches.sql})`,
      bindParams(session, matches.params),
    );
    const matchIds = idRows.map((row) => MatchIdRowSchema.parse(row).match_id);
    const timelineSource =
      matchIds.length === 0
        ? undefined
        : buildTimelineCoverageSource(files, {
            sql: "coverage_state = 'complete' AND match_id IN (SELECT unnest(?))",
            params: [listParam(matchIds)],
          });
    let timelines = 0;
    if (timelineSource !== undefined) {
      const timelineRows = await session.run(
        `SELECT COUNT(DISTINCT match_id) AS timelines FROM (${timelineSource.sql})`,
        bindParams(session, timelineSource.params),
      );
      timelines = TimelineCountRowSchema.parse(timelineRows[0]).timelines;
    }
    return {
      games: coverage.games,
      timelines,
      firstGameAt:
        coverage.first_game_ms === null
          ? null
          : new Date(coverage.first_game_ms).toISOString(),
      lastGameAt:
        coverage.last_game_ms === null
          ? null
          : new Date(coverage.last_game_ms).toISOString(),
    };
  });
}

const ResultBaseSchema = z.object({
  ok: z.boolean(),
  player: z.string().nullable(),
  message: z.string(),
});

function rankText(
  ranks: Awaited<ReturnType<typeof fetchCurrentRanks>>,
): string {
  const entries = Object.entries(ranks).map(([queue, rank]) =>
    rank === undefined
      ? `${queue}: unranked`
      : `${queue}: ${rank.tier} ${String(rank.division)}, ${rank.lp.toString()} LP (${rank.wins.toString()}W/${rank.losses.toString()}L)`,
  );
  return entries.length === 0
    ? "No current ranked entries."
    : entries.join("; ");
}

export function resolveMasteryChampionName(
  championNames: ReadonlyMap<number, string>,
  championId: number,
): string {
  const name = championNames.get(championId);
  if (name === undefined) {
    throw new Error(
      `Riot mastery references unknown champion ID ${championId.toString()}`,
    );
  }
  return name;
}

/**
 * The freshest mastery Scout can answer with, and where it came from.
 *
 * A recent paired-client capture wins: it carries the season-milestone fields
 * Riot omits. Otherwise Riot answers through its persisted snapshot, so this
 * tool shares the cache, freshness accounting and metrics the rest of the
 * mastery surface uses rather than re-fetching behind their backs. Riot is an
 * expected external boundary: when it has nothing, a stale local capture is
 * still useful, and `null` — not a throw — reports that neither source could
 * answer.
 */
async function currentMastery(
  puuid: ReturnType<typeof LeaguePuuidSchema.parse>,
  region: Region,
  count: number,
) {
  const local = await readLocalMasterySnapshot(puuid);
  const fromLocal = (snapshot: NonNullable<typeof local>) => ({
    source: "scout-client" as const,
    capturedAt: snapshot.capturedAt,
    fetchedAt: null,
    freshness: null,
    rows: snapshot.rows
      .toSorted((left, right) => right.championPoints - left.championPoints)
      .slice(0, count),
  });
  if (
    local !== null &&
    Date.now() - local.capturedAt.getTime() <= LOCAL_MASTERY_FRESHNESS_MS
  ) {
    return fromLocal(local);
  }
  const snapshot = await getChampionMasterySnapshot({ puuid, region });
  if (snapshot !== undefined) {
    return {
      source: "riot" as const,
      capturedAt: null,
      fetchedAt: snapshot.fetchedAt,
      freshness: snapshot.freshness,
      rows: topChampionMastery(snapshot.entries, count),
    };
  }
  return local === null ? null : fromLocal(local);
}

export function createRiotPlayerExploreTools(input: {
  requesterId: DiscordAccountId;
  guildIds: string[];
  track: ToolTracker;
}) {
  const resolve = async (target: z.infer<typeof RankedHistoryTargetSchema>) =>
    await resolveRiotPlayerTarget(target, input.requesterId, input.guildIds);
  return {
    inspect_player_coverage: tool({
      description:
        "Inspect exactly how many matches and complete timelines Scout already has for a Riot account, including the covered date range. Load riot-history first.",
      inputSchema: z.object({ target: RankedHistoryTargetSchema }).strict(),
      outputSchema: ResultBaseSchema.extend({
        games: z.number().int().nonnegative(),
        timelines: z.number().int().nonnegative(),
        firstGameAt: z.string().nullable(),
        lastGameAt: z.string().nullable(),
      }).strict(),
      execute: ({ target }) =>
        input.track("inspect_player_coverage", async () => {
          const targetResult = await resolve(target);
          if (targetResult.kind === "error") {
            return {
              ok: false,
              player: null,
              games: 0,
              timelines: 0,
              firstGameAt: null,
              lastGameAt: null,
              message: targetResult.message,
            };
          }
          const coverage = await inspectCoverage(targetResult.puuid);
          return {
            ok: true,
            player: targetResult.label,
            ...coverage,
            message: `Scout has ${coverage.games.toString()} matches and ${coverage.timelines.toString()} complete timelines for ${targetResult.label}.`,
          };
        }),
    }),
    get_ranked_snapshot: tool({
      description:
        "Fetch a player's current Solo/Duo and Flex ranked standings from Riot. Load riot-history first.",
      inputSchema: z.object({ target: RankedHistoryTargetSchema }).strict(),
      outputSchema: ResultBaseSchema.extend({
        ranks: z.string().nullable(),
      }).strict(),
      execute: ({ target }) =>
        input.track("get_ranked_snapshot", async () => {
          const targetResult = await resolve(target);
          if (targetResult.kind === "error") {
            return {
              ok: false,
              player: null,
              ranks: null,
              message: targetResult.message,
            };
          }
          const ranks = await fetchCurrentRanks({
            puuid: targetResult.puuid,
            region: targetResult.region,
          });
          const text = rankText(ranks);
          return {
            ok: true,
            player: targetResult.label,
            ranks: text,
            message: text,
          };
        }),
    }),
    get_champion_mastery: tool({
      description:
        "Fetch a player's current top champion mastery from Riot. This is mastery, not recent match performance. Load riot-history first.",
      inputSchema: z
        .object({
          target: RankedHistoryTargetSchema,
          count: z.number().int().min(1).max(20).default(10),
        })
        .strict(),
      outputSchema: ResultBaseSchema.extend({
        source: z.enum(["riot", "scout-client"]).nullable(),
        capturedAt: z.string().nullable(),
        fetchedAt: z.string().nullable(),
        freshness: z.enum(["fresh", "stale"]).nullable(),
        champions: z.array(
          z.object({
            championId: z.number().int().positive(),
            champion: z.string(),
            level: z.number().int().nonnegative(),
            points: z.number().int().nonnegative(),
            lastPlayedAt: z.string(),
            seasonMilestone: z.number().int().nonnegative().optional(),
            highestGrade: z.string().optional(),
            marksRequiredForNextLevel: z
              .number()
              .int()
              .nonnegative()
              .optional(),
            milestoneGrades: z.array(z.string()).optional(),
          }),
        ),
      }).strict(),
      execute: ({ target, count }) =>
        input.track("get_champion_mastery", async () => {
          const targetResult = await resolve(target);
          if (targetResult.kind === "error") {
            return {
              ok: false,
              player: null,
              source: null,
              capturedAt: null,
              fetchedAt: null,
              freshness: null,
              champions: [],
              message: targetResult.message,
            };
          }
          const mastery = await currentMastery(
            LeaguePuuidSchema.parse(targetResult.puuid),
            targetResult.region,
            count,
          );
          if (mastery === null) {
            return {
              ok: false,
              player: targetResult.label,
              source: null,
              capturedAt: null,
              fetchedAt: null,
              freshness: null,
              champions: [],
              message: `Mastery is unavailable for ${targetResult.label}.`,
            };
          }
          const championList = await getChampionList();
          const championNames = new Map(
            championList.map((champion) => [
              Number(champion.key),
              champion.name,
            ]),
          );
          const champions =
            mastery.source === "scout-client"
              ? mastery.rows.map((row) => ({
                  championId: row.championId,
                  champion: resolveMasteryChampionName(
                    championNames,
                    row.championId,
                  ),
                  level: row.championLevel,
                  points: row.championPoints,
                  lastPlayedAt: new Date(row.lastPlayTime).toISOString(),
                  seasonMilestone: row.championSeasonMilestone,
                  highestGrade: row.highestGrade,
                  marksRequiredForNextLevel: row.markRequiredForNextLevel,
                  milestoneGrades: row.milestoneGrades,
                }))
              : mastery.rows.map((row) => ({
                  championId: row.championId,
                  champion: resolveMasteryChampionName(
                    championNames,
                    row.championId,
                  ),
                  level: row.championLevel,
                  points: row.championPoints,
                  lastPlayedAt: new Date(row.lastPlayTime).toISOString(),
                }));
          return {
            ok: true,
            player: targetResult.label,
            source: mastery.source,
            capturedAt: mastery.capturedAt?.toISOString() ?? null,
            fetchedAt: mastery.fetchedAt?.toISOString() ?? null,
            freshness: mastery.freshness,
            champions,
            message: `Fetched ${champions.length.toString()} mastery entries for ${targetResult.label} from ${mastery.source === "riot" ? "Riot" : "their paired Scout Client"}.`,
          };
        }),
    }),
  };
}
