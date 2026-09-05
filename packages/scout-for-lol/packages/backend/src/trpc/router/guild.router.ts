/**
 * Web UI helpers for picking guilds and channels, and for bootstrapping the
 * caller's per-guild permissions.
 *
 * `listManageable` returns every guild the user can touch in Scout — Discord
 * admins/owners (root) plus anyone holding at least one Scout grant — each
 * enriched with the caller's effective permission set so the SPA can gate its
 * nav and controls. `myPermissions` is the same set for a single guild (used on
 * deep-links and after a role change). `listChannels` lists postable channels
 * and is gated on `channels:read`.
 */

import { z } from "zod";
import {
  type Permission,
  ALL_PERMISSIONS,
  DiscordGuildIdSchema,
  parseStoredPermissionKey,
} from "@scout-for-lol/data";
import { router, webProcedure } from "#src/trpc/trpc.ts";
import {
  guildProcedure,
  resolveGuildPermissions,
} from "#src/trpc/guild-permission.ts";
import { client as discordClient } from "#src/discord/client.ts";
import {
  hasAdministrator,
  isDevGuildOverrideGuild,
} from "#src/lib/discord-rest.ts";
import { listPostableChannels } from "#src/lib/discord/postable-channels.ts";
import { fetchUserGuildsForRequest } from "#src/trpc/discord-upstream.ts";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";

const logger = createLogger("guild-router");

export const guildRouter = router({
  /**
   * Guilds the signed-in user can access in Scout, each with the caller's
   * effective permissions: Discord admins/owners get every permission, everyone
   * else gets their granted set. Guilds with no access are omitted.
   */
  listManageable: webProcedure.query(async ({ ctx }) => {
    const userGuilds = await fetchUserGuildsForRequest(ctx.user);
    const botGuildIds = new Set(discordClient.guilds.cache.map((g) => g.id));
    const present = userGuilds.filter(
      (g) => botGuildIds.has(g.id) || isDevGuildOverrideGuild(g.id),
    );

    // One query for the user's grants across all present guilds (no N+1).
    const grantRows = await prisma.serverPermission.findMany({
      where: {
        serverId: { in: present.map((g) => g.id) },
        discordUserId: ctx.user.discordId,
      },
      select: { serverId: true, permission: true },
    });
    const grantsByGuild = new Map<string, Permission[]>();
    for (const row of grantRows) {
      const permission = parseStoredPermissionKey(row.permission);
      const list = grantsByGuild.get(row.serverId) ?? [];
      list.push(permission);
      grantsByGuild.set(row.serverId, list);
    }
    const customsByGuild = new Map(
      await Promise.all(
        present.map(
          async (guild) =>
            [
              DiscordGuildIdSchema.parse(guild.id),
              await isPolicyEnabled("custom_nights_enabled", {
                server: DiscordGuildIdSchema.parse(guild.id),
              }),
            ] as const,
        ),
      ),
    );

    const manageable = present.flatMap((g) => {
      const isDiscordAdmin = g.owner || hasAdministrator(g.permissions);
      const permissions: Permission[] = isDiscordAdmin
        ? [...ALL_PERMISSIONS]
        : (grantsByGuild.get(g.id) ?? []);
      if (permissions.length === 0) return [];
      return [
        {
          id: g.id,
          name: g.name,
          icon: g.icon,
          isOwner: g.owner,
          isDiscordAdmin,
          customNightsEnabled:
            customsByGuild.get(DiscordGuildIdSchema.parse(g.id)) ?? false,
          permissions,
        },
      ];
    });

    logger.debug(
      `User ${ctx.user.discordId} can access ${manageable.length.toString()} guild(s)`,
    );

    return manageable;
  }),

  /**
   * The caller's effective permissions in a single guild. Session-gated (not
   * permission-gated) so a viewer can bootstrap their own UI and deep-links
   * resolve even when the guild isn't in the cached `listManageable`.
   */
  myPermissions: webProcedure
    .input(z.object({ guildId: DiscordGuildIdSchema }))
    .query(async ({ ctx, input }) => {
      const permissions = await resolveGuildPermissions(
        ctx.user,
        input.guildId,
      );
      return permissions.toArray();
    }),

  /**
   * Text channels in a guild that the bot can post to. Gated on `channels:read`.
   */
  listChannels: guildProcedure("channels", "read")
    .input(z.object({ guildId: DiscordGuildIdSchema }))
    .query(({ input }) => listPostableChannels(input.guildId)),
});
