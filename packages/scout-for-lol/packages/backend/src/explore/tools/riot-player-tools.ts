import { tool } from "ai";
import { z } from "zod";
import {
  LeaguePuuidSchema,
  getChampionList,
  type DiscordAccountId,
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

const LakeCountSchema = z.union([z.bigint(), z.number()]).transform(Number);
const CoverageRowSchema = z.object({
  games: LakeCountSchema,
  first_game_ms: LakeCountSchema.nullable(),
  last_game_ms: LakeCountSchema.nullable(),
});
const TimelineCountRowSchema = z.object({ timelines: LakeCountSchema });
const MatchIdRowSchema = z.object({ match_id: z.string() });

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
        fetchedAt: z.string().nullable(),
        freshness: z.enum(["fresh", "stale"]).nullable(),
        champions: z.array(
          z.object({
            championId: z.number().int().positive(),
            champion: z.string(),
            level: z.number().int().nonnegative(),
            points: z.number().int().nonnegative(),
            lastPlayedAt: z.string(),
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
              fetchedAt: null,
              freshness: null,
              champions: [],
              message: targetResult.message,
            };
          }
          const snapshot = await getChampionMasterySnapshot({
            puuid: LeaguePuuidSchema.parse(targetResult.puuid),
            region: targetResult.region,
          });
          if (snapshot === undefined) {
            return {
              ok: false,
              player: targetResult.label,
              fetchedAt: null,
              freshness: null,
              champions: [],
              message: `Riot mastery is unavailable for ${targetResult.label}.`,
            };
          }
          const championList = await getChampionList();
          const championNames = new Map(
            championList.map((champion) => [
              Number(champion.key),
              champion.name,
            ]),
          );
          const champions = topChampionMastery(snapshot.entries, count).map(
            (row) => ({
              championId: row.championId,
              champion: resolveMasteryChampionName(
                championNames,
                row.championId,
              ),
              level: row.championLevel,
              points: row.championPoints,
              lastPlayedAt: new Date(row.lastPlayTime).toISOString(),
            }),
          );
          return {
            ok: true,
            player: targetResult.label,
            fetchedAt: snapshot.fetchedAt.toISOString(),
            freshness: snapshot.freshness,
            champions,
            message: `Fetched ${champions.length.toString()} mastery entries for ${targetResult.label}.`,
          };
        }),
    }),
  };
}
