import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  DiscordGuildIdSchema,
  HallSettingsSchema,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { launchHallBaseline } from "#src/progression/hall/launch.ts";
import { getHall } from "#src/progression/hall/read.ts";
import {
  getHallSettings,
  requestFullHallBaseline,
  updateHallSettings,
} from "#src/progression/hall/settings.ts";
import {
  guildMutationProcedure,
  guildProcedure,
  resolveGuildPermissions,
} from "#src/trpc/guild-permission.ts";
import { assertChannelInGuild } from "#src/trpc/guild-guard.ts";
import { router, webProcedure } from "#src/trpc/trpc.ts";
import { client as discordClient } from "#src/discord/client.ts";
import { isDevGuildOverrideGuild } from "#src/lib/discord-rest.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";

const GuildInputSchema = z.strictObject({ guildId: DiscordGuildIdSchema });

async function assertHallEnabled(guildId: DiscordGuildId): Promise<void> {
  if (
    !(await isPolicyEnabled("hall_of_fame_enabled", { server: guildId })) &&
    !isDevGuildOverrideGuild(guildId)
  ) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Hall of Fame is unavailable",
    });
  }
}

export const hallRouter = router({
  status: webProcedure.query(async ({ ctx }) => {
    const userGuilds = await fetchUserGuildsForRequest(ctx.user);
    const botGuildIds = new Set(discordClient.guilds.cache.map((g) => g.id));
    const present = userGuilds.filter(
      (g) => botGuildIds.has(g.id) || isDevGuildOverrideGuild(g.id),
    );
    if (present.length === 0) {
      return { state: "no_shared_guild", guilds: [] } as const;
    }
    const evaluations = await Promise.all(
      present.map(async (guild) => {
        const guildId = DiscordGuildIdSchema.parse(guild.id);
        const enabled =
          (await isPolicyEnabled("hall_of_fame_enabled", {
            server: guildId,
          })) || isDevGuildOverrideGuild(guild.id);
        return { guild, enabled };
      }),
    );
    const enabledGuilds = evaluations.flatMap((evaluation) =>
      evaluation.enabled ? [evaluation.guild] : [],
    );

    if (enabledGuilds.length === 0) {
      return { state: "feature_disabled", guilds: [] } as const;
    }

    return {
      state: "available",
      guilds: enabledGuilds.map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
      })),
    } as const;
  }),
  get: webProcedure.input(GuildInputSchema).query(async ({ ctx, input }) => {
    await assertHallEnabled(input.guildId);
    await resolveGuildPermissions(ctx.user, input.guildId);
    return await getHall(prisma, input.guildId);
  }),
  getSettings: guildProcedure("reports", "read")
    .input(GuildInputSchema)
    .query(async ({ input }) => {
      await assertHallEnabled(input.guildId);
      return await getHallSettings(prisma, input.guildId);
    }),
  updateSettings: guildMutationProcedure("reports", "update")
    .input(HallSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      await assertHallEnabled(input.guildId);
      if (input.channelId !== null) {
        await assertChannelInGuild({
          guildId: input.guildId,
          channelId: input.channelId,
        });
      }
      const result = await updateHallSettings(prisma, {
        settings: input,
        actorDiscordId: ctx.user.discordId,
        stage: configuration.environment,
      });
      await launchHallBaseline(configuration.environment, result.baseline);
      return result;
    }),
  startBaseline: guildMutationProcedure("reports", "update")
    .input(GuildInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertHallEnabled(input.guildId);
      const request = await requestFullHallBaseline(prisma, {
        guildId: input.guildId,
        actorDiscordId: ctx.user.discordId,
        stage: configuration.environment,
      });
      await launchHallBaseline(configuration.environment, request);
      return request;
    }),
});
