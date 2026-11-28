import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { assertConsumerPlayerScope } from "#src/consumer/player-access.ts";
import {
  getLiveGame,
  listLiveGames,
} from "#src/live-roster/live-roster-view.ts";
import { protectedProcedure, router } from "#src/trpc/trpc.ts";

const ListInput = z
  .object({ guildId: DiscordGuildIdSchema.optional() })
  .default({});

const GameInput = z.object({ riotMatchId: RiotMatchIdSchema });

/**
 * The Live game page's endpoints.
 *
 * Both read the `LiveGameRoster` table and nothing else: no Riot call, no S3
 * object, no lake query. Detection wrote the roster and a follow-up Activity
 * filled in the strangers' recent form; a page view only reads what is there,
 * so any number of viewers cost the same few indexed queries and none of the
 * Riot budget.
 *
 * Scope is the usual consumer scope, re-resolved on every request: Discord
 * membership, the rollout flag per server, and then a game is only visible
 * when a friend tracked in one of the viewer's own servers is in it. A game
 * that does not exist and a game the viewer may not see answer alike.
 */
export const consumerLiveRouter = router({
  list: protectedProcedure.input(ListInput).query(async ({ ctx, input }) => {
    const guilds = await assertConsumerPlayerScope(ctx.user);
    const scoped =
      input.guildId === undefined
        ? guilds
        : guilds.filter((guild) => guild.id === input.guildId);
    if (scoped.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Guild was not found",
      });
    }
    return await listLiveGames(
      scoped.map((guild) => DiscordGuildIdSchema.parse(guild.id)),
      new Date(),
    );
  }),

  game: protectedProcedure.input(GameInput).query(async ({ ctx, input }) => {
    const guilds = await assertConsumerPlayerScope(ctx.user);
    const game = await getLiveGame({
      guildIds: guilds.map((guild) => DiscordGuildIdSchema.parse(guild.id)),
      riotMatchId: input.riotMatchId,
      now: new Date(),
    });
    if (game === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Game was not found" });
    }
    return game;
  }),
});
