import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import { assertConsumerPlayerScope } from "#src/consumer/player-access.ts";
import { prisma } from "#src/database/index.ts";
import {
  fetchGuildAccountCounts,
  fetchGuildMatchRows,
} from "#src/reports/duckdb/community/community-lake.ts";
import { fetchMatchSupport } from "#src/reports/duckdb/community/match-support.ts";
import { balanceGuildTeams } from "#src/trpc/router/consumer/community-balancer.ts";
import {
  buildCommunityInsights,
  squadChemistry,
} from "#src/trpc/router/consumer/community-insights.ts";
import { listLivePrematchGames } from "#src/temporal/v2/prematch/prematch-reads.ts";
import { protectedProcedure, router } from "#src/trpc/trpc.ts";

const GuildInput = z.object({ guildId: DiscordGuildIdSchema });
const CommunityFilters = GuildInput.extend({
  windowDays: z
    .union([z.literal(30), z.literal(90), z.literal("all")])
    .default(90),
  queuePreset: z.enum(["standard", "all", "arena"]).default("standard"),
});

const STANDARD_QUEUES = [
  "solo",
  "flex",
  "ranked 5s",
  "clash",
  "normal",
  "draft pick",
  "quickplay",
  "swiftplay",
  "custom",
];

async function authorizedGuild(user: User, guildId: string) {
  const guilds = await assertConsumerPlayerScope(user);
  const guild = guilds.find((candidate) => candidate.id === guildId);
  if (guild === undefined)
    throw new TRPCError({ code: "NOT_FOUND", message: "Guild was not found" });
  return guild;
}

async function loadInsights(input: z.infer<typeof CommunityFilters>) {
  const players = await prisma.player.findMany({
    where: { serverId: input.guildId },
    select: {
      id: true,
      alias: true,
      accounts: {
        select: {
          id: true,
          puuid: true,
          riotGameName: true,
          riotTagLine: true,
          region: true,
        },
      },
    },
  });
  const puuids = [
    ...new Set(
      players.flatMap((player) =>
        player.accounts.map((account) => account.puuid),
      ),
    ),
  ];
  const afterMs =
    input.windowDays === "all"
      ? undefined
      : Date.now() - input.windowDays * 86_400_000;
  const queues =
    input.queuePreset === "standard"
      ? STANDARD_QUEUES
      : input.queuePreset === "arena"
        ? ["arena"]
        : undefined;
  const [rows, allTimeAccounts] = await Promise.all([
    fetchGuildMatchRows({
      puuids,
      ...(afterMs === undefined ? {} : { afterMs }),
      ...(queues === undefined ? {} : { queues }),
    }),
    fetchGuildAccountCounts({ puuids }),
  ]);
  return {
    players: players.map((player) => ({ id: player.id, alias: player.alias })),
    insights: buildCommunityInsights({
      players,
      rows,
      allTimeAccounts,
      standardOnly: input.queuePreset === "standard",
    }),
  };
}

export const consumerGuildRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const guilds = await assertConsumerPlayerScope(ctx.user);
    return guilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
    }));
  }),

  overview: protectedProcedure
    .input(CommunityFilters)
    .query(async ({ ctx, input }) => {
      const guild = await authorizedGuild(ctx.user, input.guildId);
      return {
        guild: { id: guild.id, name: guild.name, icon: guild.icon },
        ...(await loadInsights(input)),
      };
    }),

  balance: protectedProcedure
    .input(
      CommunityFilters.extend({
        playerIds: z.array(z.number().int().positive()).length(10),
        priority: z.enum(["roles", "strength"]).default("roles"),
      }),
    )
    .query(async ({ ctx, input }) => {
      await authorizedGuild(ctx.user, input.guildId);
      if (new Set(input.playerIds).size !== 10) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose ten unique guild players",
        });
      }
      const { players, insights } = await loadInsights({
        guildId: input.guildId,
        windowDays: input.windowDays,
        queuePreset: "standard",
      });
      if (
        input.playerIds.some(
          (id) => !players.some((player) => player.id === id),
        )
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "A selected guild player was not found",
        });
      }
      const forms = insights.forms.filter((form) =>
        input.playerIds.includes(form.playerId),
      );
      return balanceGuildTeams(forms, input.priority);
    }),

  squad: protectedProcedure
    .input(
      CommunityFilters.extend({
        playerIds: z.array(z.number().int().positive()).min(2).max(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      await authorizedGuild(ctx.user, input.guildId);
      if (new Set(input.playerIds).size !== input.playerIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose unique guild players",
        });
      }
      const players = await prisma.player.findMany({
        where: { serverId: input.guildId },
        select: {
          id: true,
          alias: true,
          accounts: {
            select: {
              id: true,
              puuid: true,
              riotGameName: true,
              riotTagLine: true,
              region: true,
            },
          },
        },
      });
      if (
        input.playerIds.some(
          (id) => !players.some((player) => player.id === id),
        )
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "A selected guild player was not found",
        });
      }
      const rows = await fetchGuildMatchRows({
        puuids: players.flatMap((player) =>
          player.accounts.map((account) => account.puuid),
        ),
        ...(input.windowDays === "all"
          ? {}
          : { afterMs: Date.now() - input.windowDays * 86_400_000 }),
        queues: STANDARD_QUEUES,
      });
      return squadChemistry({ players, rows, playerIds: input.playerIds });
    }),

  live: protectedProcedure.input(GuildInput).query(async ({ ctx, input }) => {
    await authorizedGuild(ctx.user, input.guildId);
    const players = await prisma.player.findMany({
      where: { serverId: input.guildId },
      select: { id: true, alias: true, accounts: { select: { puuid: true } } },
    });
    const byPuuid = new Map<string, { playerId: number; alias: string }>(
      players.flatMap((player) =>
        player.accounts.map(
          (account) =>
            [
              account.puuid,
              { playerId: player.id, alias: player.alias },
            ] as const,
        ),
      ),
    );
    // The V2 prematch captures, not `ActiveGame`: only v1 wrote that table.
    // A game the report lake already holds is over, whatever its TTL says.
    const live = await listLivePrematchGames({
      now: new Date(),
      completedMatchIds: async (matchIds) => {
        const completed = await fetchMatchSupport({ matchIds: [...matchIds] });
        return new Set(completed.map((match) => match.match_id));
      },
    });
    return live
      .flatMap((game) => {
        const guildPlayers = [
          ...new Map(
            game.participantPuuids.flatMap((puuid) => {
              const player = byPuuid.get(puuid);
              return player === undefined
                ? []
                : [[player.playerId, player] as const];
            }),
          ).values(),
        ];
        return guildPlayers.length === 0
          ? []
          : [
              {
                gameId: game.gameId,
                detectedAt: game.detectedAt,
                expiresAt: game.expiresAt,
                players: guildPlayers,
              },
            ];
      })
      .toSorted(
        (left, right) => right.detectedAt.getTime() - left.detectedAt.getTime(),
      );
  }),
});
