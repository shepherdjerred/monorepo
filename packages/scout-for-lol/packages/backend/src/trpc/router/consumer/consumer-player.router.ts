import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DiscordGuildIdSchema,
  PlayerIdSchema,
  PlayerProfileGameWindowSchema,
  PlayerProfileQueueSelectionSchema,
} from "@scout-for-lol/data";
import { Prisma } from "#generated/prisma/client/index.js";
import { prisma } from "#src/database/index.ts";
import {
  assertConsumerPlayerScope,
  resolveConsumerPlayerScope,
} from "#src/consumer/player-access.ts";
import {
  getConsumerPlayerMatchHistory,
  getConsumerPlayerProfileSummary,
} from "#src/lib/player-profile/queries.ts";
import { protectedProcedure, router } from "#src/trpc/trpc.ts";

const ConsumerPlayerInput = z.object({
  playerId: PlayerIdSchema,
});

const ConsumerPlayerStatusInput = z
  .object({
    guildId: DiscordGuildIdSchema,
  })
  .optional();

const FilterInput = z.object({
  games: PlayerProfileGameWindowSchema.default(20),
  queues: PlayerProfileQueueSelectionSchema.optional(),
});

const MatchHistoryCursorSchema = z.object({
  gameCreationMs: z.number().int(),
  matchId: z.string().min(1),
  consumed: z.number().int().nonnegative().optional(),
});

const SearchInput = z.object({
  query: z.string().trim().min(1).max(100),
});

const RankedPlayerRowsSchema = z.array(
  z.object({
    id: PlayerIdSchema,
  }),
);

/**
 * Rank authorized player ids without ever loading an out-of-scope candidate
 * into application memory. Exact Riot IDs and aliases win, followed by
 * prefixes, substrings, and finally typo-tolerant trigram similarity.
 *
 * One-character queries intentionally remain substring-only. PostgreSQL
 * trigrams become useful at three characters, while preserving the original
 * API's one-character compatibility avoids surprising existing callers.
 */
async function rankedConsumerPlayerIds(input: {
  guildIds: string[];
  query: string;
}): Promise<z.infer<typeof PlayerIdSchema>[]> {
  const normalizedQuery = input.query.toLowerCase();
  const fuzzyEnabled = normalizedQuery.length >= 3;
  const rows: unknown = await prisma.$queryRaw(
    Prisma.sql`
      WITH scoped_candidates AS (
        SELECT
          player."id",
          player."alias",
          lower(player."alias") AS alias_key,
          lower(COALESCE(account."riotGameName", '')) AS game_name_key,
          lower(COALESCE(account."riotTagLine", '')) AS tag_line_key,
          lower(
            COALESCE(account."riotGameName", '') || '#' ||
            COALESCE(account."riotTagLine", '')
          ) AS riot_id_key
        FROM "Player" AS player
        LEFT JOIN "Account" AS account ON account."playerId" = player."id"
        WHERE player."serverId" IN (${Prisma.join(input.guildIds)})
      ),
      ranked AS (
        SELECT
          "id",
          min("alias") AS alias,
          max(
            CASE
              WHEN alias_key = ${normalizedQuery}
                OR game_name_key = ${normalizedQuery}
                OR tag_line_key = ${normalizedQuery}
                OR riot_id_key = ${normalizedQuery}
                THEN 4
              WHEN alias_key LIKE ${`${normalizedQuery}%`}
                OR game_name_key LIKE ${`${normalizedQuery}%`}
                OR tag_line_key LIKE ${`${normalizedQuery}%`}
                OR riot_id_key LIKE ${`${normalizedQuery}%`}
                THEN 3
              WHEN alias_key LIKE ${`%${normalizedQuery}%`}
                OR game_name_key LIKE ${`%${normalizedQuery}%`}
                OR tag_line_key LIKE ${`%${normalizedQuery}%`}
                OR riot_id_key LIKE ${`%${normalizedQuery}%`}
                THEN 2
              ELSE 1
            END
          ) AS match_rank,
          max(
            GREATEST(
              similarity(alias_key, ${normalizedQuery}),
              similarity(game_name_key, ${normalizedQuery}),
              similarity(tag_line_key, ${normalizedQuery}),
              similarity(riot_id_key, ${normalizedQuery})
            )
          ) AS fuzzy_score
        FROM scoped_candidates
        WHERE
          alias_key LIKE ${`%${normalizedQuery}%`}
          OR game_name_key LIKE ${`%${normalizedQuery}%`}
          OR tag_line_key LIKE ${`%${normalizedQuery}%`}
          OR riot_id_key LIKE ${`%${normalizedQuery}%`}
          OR (
            ${fuzzyEnabled}
            AND GREATEST(
              similarity(alias_key, ${normalizedQuery}),
              similarity(game_name_key, ${normalizedQuery}),
              similarity(tag_line_key, ${normalizedQuery}),
              similarity(riot_id_key, ${normalizedQuery})
            ) >= 0.25
          )
        GROUP BY "id"
      )
      SELECT "id"
      FROM ranked
      ORDER BY match_rank DESC, fuzzy_score DESC, lower(alias) ASC, "id" ASC
      LIMIT 20
    `,
  );
  return RankedPlayerRowsSchema.parse(rows).map((row) => row.id);
}

function guildDisplay(
  guilds: { id: string; name: string; icon: string | null }[],
  guildId: string,
) {
  const guild = guilds.find((candidate) => candidate.id === guildId);
  if (guild === undefined) {
    throw new Error("Authorized player resolved outside its request scope");
  }
  return {
    name: guild.name,
  };
}

type HomePlayer = {
  id: number;
  alias: string;
  serverId: string;
  discordId: string | null;
  accounts: {
    riotGameName: string | null;
    riotTagLine: string | null;
    region: string;
    lastMatchTime: Date | null;
  }[];
};

function latestMatch(player: HomePlayer): Date | null {
  return player.accounts.reduce<Date | null>((latest, account) => {
    if (account.lastMatchTime === null) return latest;
    return latest === null || account.lastMatchTime > latest
      ? account.lastMatchTime
      : latest;
  }, null);
}

function homePlayer(
  player: HomePlayer,
  guilds: { id: string; name: string; icon: string | null }[],
) {
  return {
    playerId: player.id,
    alias: player.alias,
    guild: guildDisplay(guilds, player.serverId),
    lastMatchTime: latestMatch(player),
    accounts: player.accounts.map((account) => ({
      gameName: account.riotGameName,
      tagLine: account.riotTagLine,
      region: account.region,
    })),
  };
}

export const consumerPlayerRouter = router({
  status: protectedProcedure
    .input(ConsumerPlayerStatusInput)
    .query(async ({ ctx, input }) => {
      const scope = await resolveConsumerPlayerScope(ctx.user);
      if (scope.kind === "unavailable") {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message:
            "Scout could not verify its connected servers. Try again soon.",
        });
      }
      if (scope.kind === "forbidden") {
        return { state: scope.reason } as const;
      }
      if (
        input?.guildId !== undefined &&
        !scope.guilds.some((guild) => guild.id === input.guildId)
      ) {
        return { state: "feature_disabled" } as const;
      }
      return { state: "available", guildCount: scope.guilds.length } as const;
    }),

  home: protectedProcedure.query(async ({ ctx }) => {
    const guilds = await assertConsumerPlayerScope(ctx.user);
    const guildIds = guilds.map((guild) =>
      DiscordGuildIdSchema.parse(guild.id),
    );
    const players = await prisma.player.findMany({
      where: { serverId: { in: guildIds } },
      select: {
        id: true,
        alias: true,
        serverId: true,
        discordId: true,
        accounts: {
          select: {
            riotGameName: true,
            riotTagLine: true,
            region: true,
            lastMatchTime: true,
          },
        },
      },
    });
    const yourProfiles = players
      .filter((player) => player.discordId === ctx.user.discordId)
      .toSorted((left, right) => {
        const recent =
          (latestMatch(right)?.getTime() ?? 0) -
          (latestMatch(left)?.getTime() ?? 0);
        return recent === 0 ? left.alias.localeCompare(right.alias) : recent;
      })
      .map((player) => homePlayer(player, guilds));
    const recentPlayers = players
      .filter(
        (player) =>
          player.discordId !== ctx.user.discordId &&
          latestMatch(player) !== null,
      )
      .toSorted((left, right) => {
        const leftMatch = latestMatch(left);
        const rightMatch = latestMatch(right);
        if (leftMatch === null || rightMatch === null) {
          throw new Error("Recently active player is missing activity");
        }
        const recent = rightMatch.getTime() - leftMatch.getTime();
        if (recent !== 0) return recent;
        const alias = left.alias.localeCompare(right.alias);
        return alias === 0 ? left.id - right.id : alias;
      })
      .slice(0, 6)
      .map((player) => homePlayer(player, guilds));
    return { yourProfiles, recentPlayers };
  }),

  search: protectedProcedure
    .input(SearchInput)
    .query(async ({ ctx, input }) => {
      const guilds = await assertConsumerPlayerScope(ctx.user);
      const guildIds = guilds.map((guild) =>
        DiscordGuildIdSchema.parse(guild.id),
      );
      const rankedIds = await rankedConsumerPlayerIds({
        guildIds,
        query: input.query,
      });
      const players = await prisma.player.findMany({
        where: {
          id: { in: rankedIds },
          serverId: { in: guildIds },
        },
        select: {
          id: true,
          alias: true,
          serverId: true,
          accounts: {
            select: {
              riotGameName: true,
              riotTagLine: true,
              region: true,
              lastCheckedAt: true,
            },
          },
        },
      });

      const playersById = new Map(
        players.map((player) => [player.id, player] as const),
      );

      return {
        results: rankedIds.map((playerId) => {
          const player = playersById.get(playerId);
          if (player === undefined) {
            throw new Error("Ranked consumer player disappeared during search");
          }
          return {
            playerId: player.id,
            alias: player.alias,
            guild: guildDisplay(guilds, player.serverId),
            accounts: player.accounts.map((account) => ({
              gameName: account.riotGameName,
              tagLine: account.riotTagLine,
              region: account.region,
              lastCheckedAt: account.lastCheckedAt,
            })),
          };
        }),
      };
    }),

  profileSummary: protectedProcedure
    .input(ConsumerPlayerInput.extend(FilterInput.shape))
    .query(async ({ ctx, input }) => {
      const guilds = await assertConsumerPlayerScope(ctx.user);
      const summary = await getConsumerPlayerProfileSummary({
        playerId: input.playerId,
        guildIds: guilds.map((guild) => DiscordGuildIdSchema.parse(guild.id)),
        games: input.games,
        ...(input.queues === undefined ? {} : { queues: input.queues }),
      });
      const { guildId, ...profile } = summary;
      return { ...profile, guild: guildDisplay(guilds, guildId) };
    }),

  matchHistory: protectedProcedure
    .input(
      ConsumerPlayerInput.extend(FilterInput.shape).extend({
        limit: z.number().int().min(1).max(50).default(20),
        cursor: MatchHistoryCursorSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const guilds = await assertConsumerPlayerScope(ctx.user);
      return getConsumerPlayerMatchHistory({
        playerId: input.playerId,
        guildIds: guilds.map((guild) => DiscordGuildIdSchema.parse(guild.id)),
        limit: input.limit,
        games: input.games,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.queues === undefined ? {} : { queues: input.queues }),
      });
    }),
});
