import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  ChampionComparisonCohortSchema,
  ChampionComparisonCursorSchema,
  ChampionComparisonSortSchema,
  ChampionIdSchema,
  computeKda,
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
import { enqueueChampionMasteryRefresh } from "#src/temporal/work-store.ts";
import {
  getCachedChampionMasterySnapshots,
  masteryForChampion,
} from "#src/league/champion-mastery/snapshots.ts";

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

type MasteryRow = {
  playerId: number;
  alias: string;
  guild: { guildId: string; name: string };
  viewerLinked: boolean;
  account: { gameName: string | null; tagLine: string | null; region: string };
  level: number;
  points: number;
  fetchedAt: Date;
  freshness: "fresh" | "stale";
};

const ScopedPlayerSelect = {
  id: true,
  alias: true,
  serverId: true,
  discordId: true,
  accounts: {
    select: {
      puuid: true,
      riotGameName: true,
      riotTagLine: true,
      region: true,
    },
  },
} as const;

async function findScopedPlayers(guildIds: readonly string[]) {
  return await prisma.player.findMany({
    where: { serverId: { in: [...guildIds] } },
    select: ScopedPlayerSelect,
  });
}

async function getScopedChampionPlayers(
  user: Parameters<typeof assertConsumerPlayerScope>[0],
  requestedGuildIds: readonly string[] | undefined,
) {
  const accessibleGuilds = await assertConsumerPlayerScope(user);
  const accessibleIds = new Set(accessibleGuilds.map((guild) => guild.id));
  const selectedGuildIds =
    requestedGuildIds ??
    accessibleGuilds.map((guild) => DiscordGuildIdSchema.parse(guild.id));
  if (selectedGuildIds.some((guildId) => !accessibleIds.has(guildId))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Requested guild is outside the current player scope",
    });
  }
  return {
    accessibleGuilds,
    players: await findScopedPlayers(selectedGuildIds),
  };
}

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
    return guild === 0 ? left.playerId - right.playerId : guild;
  };
}

export const consumerChampionRouter = router({
  masteryLeaderboard: protectedProcedure
    .input(
      z.object({
        championId: ChampionIdSchema,
        guildIds: GuildSelectionSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { accessibleGuilds, players } = await getScopedChampionPlayers(
        ctx.user,
        input.guildIds,
      );
      const snapshots = await getCachedChampionMasterySnapshots({
        puuids: players.flatMap((player) =>
          player.accounts.map((account) => account.puuid),
        ),
      });
      const refreshesByPuuid = new Map<
        string,
        { puuid: string; region: string; fetchedAt: Date | undefined }
      >();
      for (const player of players) {
        for (const account of player.accounts) {
          const snapshot = snapshots.get(account.puuid);
          if (snapshot?.freshness === "fresh") continue;
          refreshesByPuuid.set(account.puuid, {
            puuid: account.puuid,
            region: account.region,
            fetchedAt: snapshot?.fetchedAt,
          });
        }
      }
      await Promise.allSettled(
        [...refreshesByPuuid.values()].map(async (refresh) => {
          await enqueueChampionMasteryRefresh(refresh);
        }),
      );
      const guildById = new Map(
        accessibleGuilds.map((guild) => [guild.id, guild] as const),
      );
      const rows = players.flatMap((player): MasteryRow[] => {
        const guild = guildById.get(player.serverId);
        if (guild === undefined) {
          throw new Error("Champion mastery returned an unscoped guild");
        }
        const candidates = player.accounts.flatMap((account) => {
          const snapshot = snapshots.get(account.puuid);
          if (snapshot === undefined) return [];
          const mastery = masteryForChampion(
            snapshot.entries,
            input.championId,
          );
          return mastery === undefined ? [] : [{ account, snapshot, mastery }];
        });
        const best = candidates.toSorted((left, right) => {
          const points =
            right.mastery.championPoints - left.mastery.championPoints;
          return points === 0
            ? right.mastery.championLevel - left.mastery.championLevel
            : points;
        })[0];
        if (best === undefined) return [];
        return [
          {
            playerId: player.id,
            alias: player.alias,
            guild: { guildId: guild.id, name: guild.name },
            viewerLinked: player.discordId === ctx.user.discordId,
            account: {
              gameName: best.account.riotGameName,
              tagLine: best.account.riotTagLine,
              region: best.account.region,
            },
            level: best.mastery.championLevel,
            points: best.mastery.championPoints,
            fetchedAt: best.snapshot.fetchedAt,
            freshness: best.snapshot.freshness,
          },
        ];
      });
      const ordered = rows.toSorted((left, right) => {
        const points = right.points - left.points;
        if (points !== 0) return points;
        const level = right.level - left.level;
        if (level !== 0) return level;
        const alias = left.alias.localeCompare(right.alias);
        if (alias !== 0) return alias;
        const guild = left.guild.name.localeCompare(right.guild.name);
        return guild === 0 ? left.playerId - right.playerId : guild;
      });
      const accountCount = players.reduce(
        (count, player) => count + player.accounts.length,
        0,
      );
      const cachedAccountCount = players.reduce(
        (count, player) =>
          count +
          player.accounts.filter((account) => snapshots.has(account.puuid))
            .length,
        0,
      );
      return {
        champion: {
          championId: input.championId,
          name: getChampionDisplayName(input.championId),
        },
        rows: ordered.slice(0, 25),
        cachedAccountCount,
        accountCount,
      };
    }),
  compare: protectedProcedure
    .input(ComparisonInput)
    .query(async ({ ctx, input }) => {
      const { accessibleGuilds, players } = await getScopedChampionPlayers(
        ctx.user,
        input.guildIds,
      );
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
          kda: computeKda(lakeRow),
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
