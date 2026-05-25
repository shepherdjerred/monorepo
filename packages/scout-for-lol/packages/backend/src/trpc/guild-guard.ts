/**
 * Shared check for "the signed-in web user is an Administrator of the
 * target guild AND Scout is installed there." Mirrors the Discord-side
 * `setDefaultMemberPermissions(Administrator)` gate on /subscription *.
 */

import { TRPCError } from "@trpc/server";
import { ChannelType } from "discord.js";
import type { User } from "#generated/prisma/client/index.js";
import { fetchUserGuilds, hasAdministrator } from "#src/lib/discord-rest.ts";
import { client as discordClient } from "#src/discord/client.ts";

export async function assertGuildAdmin(params: {
  user: User;
  guildId: string;
}): Promise<void> {
  const guilds = await fetchUserGuilds(params.user);
  const match = guilds.find((g) => g.id === params.guildId);
  if (match === undefined) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of that guild",
    });
  }
  if (!match.owner && !hasAdministrator(match.permissions)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Administrator permission required",
    });
  }
  if (!discordClient.guilds.cache.has(params.guildId)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Scout is not installed in that guild",
    });
  }
}

/**
 * Verifies that `channelId` is a postable text/announcement channel inside
 * `guildId`. Without this, an admin of guild A could pass any channel ID
 * (even one belonging to guild B) into a subscription mutation and have
 * Scout's poll cycle later post into that foreign channel — `assertGuildAdmin`
 * alone is not enough because it only proves admin on the *requested* guild.
 *
 * Mirrors the filter in `guildRouter.listChannels` so mutations only accept
 * channels the picker would have offered.
 */
export function assertChannelInGuild(params: {
  guildId: string;
  channelId: string;
}): void {
  const guild = discordClient.guilds.cache.get(params.guildId);
  if (guild === undefined) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Scout is not installed in that guild",
    });
  }
  const channel = guild.channels.cache.get(params.channelId);
  if (channel === undefined) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Channel does not belong to that guild",
    });
  }
  if (
    channel.type !== ChannelType.GuildText &&
    channel.type !== ChannelType.GuildAnnouncement
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Channel must be a text or announcement channel",
    });
  }
}
