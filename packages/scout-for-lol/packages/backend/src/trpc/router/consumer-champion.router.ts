import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  ChampionComparisonCohortSchema,
  ChampionComparisonCursorSchema,
  ChampionComparisonSortSchema,
  ChampionIdSchema,
  DiscordGuildIdSchema,
  PlayerProfileGameWindowSchema,
  PlayerProfileQueueSelectionSchema,
  getChampionDisplayName,
  type ChampionComparisonSort,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { assertConsumerPlayerScope } from "#src/consumer/player-access.ts";
import { fetchChampionComparisons } from "#src/reports/duckdb/consumer-profile-lake-reads.ts";
import { protectedProcedure, router } from "#src/trpc/trpc.ts";

const PAGE_SIZE = 25;
const QUALIFYING_GAMES = 10;

const GuildSelectionSchema = z
  .array(DiscordGuildIdSchema)
  .min(1)
  .superRefine((guildIds, context) => {
    if (new Set(guildIds).size !== guildIds.length) {
      context.addIssue({ code: "custom", message: "Guilds must be unique" });
    }
  });

const ComparisonInput = z.object({
  championId: ChampionIdSchema,
  games: PlayerProfileGameWindowSchema.default(20),
  queues: PlayerProfileQueueSelectionSchema.optional(),
  guildIds: GuildSelectionSchema.optional(),
  cohort: ChampionComparisonCohortSchema.default("qualified"),
  sort: ChampionComparisonSortSchema.default("win_rate"),
  cursor: ChampionComparisonCursorSchema.optional(),
});

type ComparisonRow = {
  playerId: number;
  alias: string;
  guild: { guildId: string; name: string };
  viewerLinked: boolean;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
  kda: number;
  csPerMinute: number;
  damagePerMinute: number;
  goldPerMinute: number;
  visionPerMinute: number;
};

function metric(row: ComparisonRow, sort: ChampionComparisonSort): number {
  switch (sort) {
    case "win_rate":
      return row.winRate;
    case "games":
      return row.games;
    case "kda":
      return row.kda;
    case "cs_per_minute":
      return row.csPerMinute;
    case "damage_per_minute":
      return row.damagePerMinute;
    case "gold_per_minute":
      return row.goldPerMinute;
    case "vision_per_minute":
      return row.visionPerMinute;
    case "alias":
      return 0;
  }
}

function comparisonOrder(
  sort: ChampionComparisonSort,
): (left: ComparisonRow, right: ComparisonRow) => number {
  return (left, right) => {
    if (sort === "alias") {
      const alias = left.alias.localeCompare(right.alias);
      if (alias !== 0) return alias;
    } else {
      const selected = metric(right, sort) - metric(left, sort);
      if (selected !== 0) return selected;
    }
    if (sort !== "games" && right.games !== left.games) {
      return right.games - left.games;
    }
    if (sort !== "kda" && right.kda !== left.kda) {
      return right.kda - left.kda;
    }
    if (sort !== "alias") {
      const alias = left.alias.localeCompare(right.alias);
      if (alias !== 0) return alias;
    }
    const guild = left.guild.name.localeCompare(right.guild.name);
    if (guild !== 0) return guild;
    return left.playerId - right.playerId;
  };
}

export const consumerChampionRouter = router({
  compare: protectedProcedure
    .input(ComparisonInput)
    .query(async ({ ctx, input }) => {
      const accessibleGuilds = await assertConsumerPlayerScope(ctx.user);
      const accessibleIds = new Set(accessibleGuilds.map((guild) => guild.id));
      const selectedGuildIds =
        input.guildIds ??
        accessibleGuilds.map((guild) => DiscordGuildIdSchema.parse(guild.id));
      if (selectedGuildIds.some((guildId) => !accessibleIds.has(guildId))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Requested guild is outside the current player scope",
        });
      }
      const players = await prisma.player.findMany({
        where: { serverId: { in: selectedGuildIds } },
        select: {
          id: true,
          alias: true,
          serverId: true,
          discordId: true,
          accounts: { select: { puuid: true } },
        },
      });
      const lakeRows = await fetchChampionComparisons({
        championId: input.championId,
        games: input.games,
        entries: players.map((player) => ({
          entryKey: player.id.toString(),
          puuids: player.accounts.map((account) => account.puuid),
        })),
        ...(input.queues === undefined ? {} : { queues: input.queues }),
      });
      const playerById = new Map(
        players.map((player) => [player.id.toString(), player] as const),
      );
      const guildById = new Map(
        accessibleGuilds.map((guild) => [guild.id, guild] as const),
      );
      const rows = lakeRows.map((lakeRow): ComparisonRow => {
        const player = playerById.get(lakeRow.entry_key);
        if (player === undefined) {
          throw new Error("Champion comparison returned an unrequested player");
        }
        const guild = guildById.get(player.serverId);
        if (guild === undefined) {
          throw new Error("Champion comparison returned an unscoped guild");
        }
        const minutes = lakeRow.time_played / 60;
        return {
          playerId: player.id,
          alias: player.alias,
          guild: { guildId: guild.id, name: guild.name },
          viewerLinked: player.discordId === ctx.user.discordId,
          games: lakeRow.games,
          wins: lakeRow.wins,
          losses: lakeRow.games - lakeRow.wins,
          winRate: lakeRow.wins / lakeRow.games,
          kda:
            lakeRow.deaths === 0
              ? lakeRow.kills + lakeRow.assists
              : (lakeRow.kills + lakeRow.assists) / lakeRow.deaths,
          csPerMinute: minutes > 0 ? lakeRow.creep_score / minutes : 0,
          damagePerMinute:
            minutes > 0 ? lakeRow.damage_to_champions / minutes : 0,
          goldPerMinute: minutes > 0 ? lakeRow.gold_earned / minutes : 0,
          visionPerMinute: minutes > 0 ? lakeRow.vision_score / minutes : 0,
        };
      });
      const cohortRows = rows
        .filter((row) =>
          input.cohort === "qualified"
            ? row.games >= QUALIFYING_GAMES
            : row.games < QUALIFYING_GAMES,
        )
        .toSorted(comparisonOrder(input.sort));
      const offset = input.cursor?.offset ?? 0;
      const page = cohortRows.slice(offset, offset + PAGE_SIZE);
      const nextOffset = offset + page.length;
      return {
        champion: {
          championId: input.championId,
          name: getChampionDisplayName(input.championId),
        },
        qualifyingGames: QUALIFYING_GAMES,
        availableGuilds: accessibleGuilds.map((guild) => ({
          guildId: guild.id,
          name: guild.name,
        })),
        rows: page,
        nextCursor:
          nextOffset < cohortRows.length ? { offset: nextOffset } : null,
      };
    }),
});
