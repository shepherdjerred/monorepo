import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DiscordGuildIdSchema, type DiscordGuildId } from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import {
  assertClashSurfaceEnabled,
  assertClashSurfaceEnabledForGuild,
  clashSurfaceStatus,
} from "#src/league/clash/access.ts";
import { readClientClashBracketsForGuild } from "#src/league/clash/client-clash.ts";
import { readClashHistoryForGuild } from "#src/league/clash/history.ts";
import {
  readClashRosterForGuild,
  readClashSchedule,
} from "#src/league/clash/store.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";
import { router, webProcedure } from "#src/trpc/trpc.ts";

const GuildInputSchema = z.strictObject({ guildId: DiscordGuildIdSchema });

async function assertClashGuildReadable(
  user: User,
  guildId: DiscordGuildId,
  surface: "roster" | "history",
): Promise<void> {
  await assertClashSurfaceEnabledForGuild(guildId);
  const guilds = await fetchUserGuildsForRequest(user);
  if (!guilds.some((guild) => guild.id === guildId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Clash ${surface} is visible only for a guild you belong to`,
    });
  }
}

export const clashRouter = router({
  status: webProcedure.query(async ({ ctx }) => clashSurfaceStatus(ctx.user)),
  schedule: webProcedure.query(async ({ ctx }) => {
    await assertClashSurfaceEnabled(ctx.user);
    return {
      tournaments: await readClashSchedule(),
      resultsNote:
        "Riot supplies the schedule. Scout Client can add brackets and results when a tracked player observes them.",
    };
  }),
  roster: webProcedure.input(GuildInputSchema).query(async ({ ctx, input }) => {
    await assertClashGuildReadable(ctx.user, input.guildId, "roster");
    return {
      teams: await readClashRosterForGuild(input.guildId),
      brackets: await readClientClashBracketsForGuild(input.guildId),
      resultsNote:
        "Roster is who Riot lists as registered this weekend among tracked players. A bracket and its results appear only when a tracked player's Scout Client saw them.",
    };
  }),
  history: webProcedure
    .input(GuildInputSchema)
    .query(async ({ ctx, input }) => {
      await assertClashGuildReadable(ctx.user, input.guildId, "history");
      return {
        cups: await readClashHistoryForGuild(input.guildId),
        brackets: await readClientClashBracketsForGuild(input.guildId, true),
        resultsNote:
          "Past Clash games and client-observed brackets. Results appear when Riot or Scout Client supplies a completed game.",
      };
    }),
});
