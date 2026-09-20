import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  assertClashSurfaceEnabled,
  clashSurfaceStatus,
} from "#src/league/clash/access.ts";
import { readClashHistoryForGuild } from "#src/league/clash/history.ts";
import {
  readClashRosterForGuild,
  readClashSchedule,
} from "#src/league/clash/store.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";
import { router, webProcedure } from "#src/trpc/trpc.ts";

export const clashRouter = router({
  status: webProcedure.query(async ({ ctx }) => clashSurfaceStatus(ctx.user)),
  schedule: webProcedure.query(async ({ ctx }) => {
    await assertClashSurfaceEnabled(ctx.user);
    return {
      tournaments: await readClashSchedule(),
      resultsNote:
        "Current Clash games are pre-match only. Riot does not publish results, so Scout cannot score them.",
    };
  }),
  roster: webProcedure
    .input(z.strictObject({ guildId: DiscordGuildIdSchema }))
    .query(async ({ ctx, input }) => {
      await assertClashSurfaceEnabled(ctx.user);
      const guilds = await fetchUserGuildsForRequest(ctx.user);
      if (!guilds.some((guild) => guild.id === input.guildId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Clash roster is visible only for a guild you belong to",
        });
      }
      return {
        teams: await readClashRosterForGuild(input.guildId),
        resultsNote:
          "Roster is who is registered this weekend among tracked players. There is no bracket or win/loss.",
      };
    }),
  history: webProcedure
    .input(z.strictObject({ guildId: DiscordGuildIdSchema }))
    .query(async ({ ctx, input }) => {
      await assertClashSurfaceEnabled(ctx.user);
      const guilds = await fetchUserGuildsForRequest(ctx.user);
      if (!guilds.some((guild) => guild.id === input.guildId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Clash history is visible only for a guild you belong to",
        });
      }
      return {
        cups: await readClashHistoryForGuild(input.guildId),
        resultsNote:
          "Past Clash lobbies Scout saw. Current weekends have no score. Games through Feb 2026 may show a result.",
      };
    }),
});
