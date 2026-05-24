/**
 * Web UI helper procedures for picking guilds and channels.
 *
 * `listManageable` filters the signed-in user's Discord guilds to those
 * where they have Administrator AND Scout is installed (mirroring the
 * Discord-command permission gate).
 *
 * `listChannels` returns text channels in a guild that the bot can see,
 * so the web UI only offers channels Scout could actually post to.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  ChannelType,
  PermissionFlagsBits,
  type GuildBasedChannel,
} from "discord.js";
import { router, webProcedure } from "#src/trpc/trpc.ts";
import { client as discordClient } from "#src/discord/client.ts";
import { fetchUserGuilds, hasAdministrator } from "#src/lib/discord-rest.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("guild-router");

export const guildRouter = router({
  /**
   * Guilds the signed-in user can manage in Scout: Administrator perm AND
   * Scout bot is currently a member.
   */
  listManageable: webProcedure.query(async ({ ctx }) => {
    const userGuilds = await fetchUserGuilds(ctx.user);
    const botGuildIds = new Set(discordClient.guilds.cache.map((g) => g.id));

    const manageable = userGuilds
      .filter(
        (g) =>
          (g.owner || hasAdministrator(g.permissions)) && botGuildIds.has(g.id),
      )
      .map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon,
        isOwner: g.owner,
      }));

    logger.debug(
      `User ${ctx.user.discordId} can manage ${manageable.length.toString()} guild(s)`,
    );

    return manageable;
  }),

  /**
   * Text channels in a guild that the bot has view access to.
   * Admin-gated: the signed-in user must be an Administrator of the guild.
   */
  listChannels: webProcedure
    .input(z.object({ guildId: z.string() }))
    .query(async ({ ctx, input }) => {
      const userGuilds = await fetchUserGuilds(ctx.user);
      const target = userGuilds.find((g) => g.id === input.guildId);
      if (target === undefined) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of that guild",
        });
      }
      if (!target.owner && !hasAdministrator(target.permissions)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Administrator permission required",
        });
      }

      const guild = discordClient.guilds.cache.get(input.guildId);
      if (guild === undefined) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scout is not installed in that guild",
        });
      }

      const me = guild.members.me;
      const channels = guild.channels.cache
        .filter((c: GuildBasedChannel) => {
          const isText =
            c.type === ChannelType.GuildText ||
            c.type === ChannelType.GuildAnnouncement;
          if (!isText) return false;
          // Only offer channels the bot can actually post in. Without
          // this we'd show channels Scout could read but never message.
          const perms = me?.permissionsIn(c);
          return (
            perms !== undefined &&
            perms.has(PermissionFlagsBits.ViewChannel) &&
            perms.has(PermissionFlagsBits.SendMessages)
          );
        })
        .map((c: GuildBasedChannel) => ({
          id: c.id,
          name: c.name,
          parentId: c.parentId,
        }));

      // Channels are returned sorted by position via discord.js position()
      // — fall back to name ordering to keep the response deterministic.
      channels.sort((a, b) => a.name.localeCompare(b.name));

      return channels;
    }),
});
