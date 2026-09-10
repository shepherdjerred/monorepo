/**
 * Shared check for "the signed-in web user is an Administrator of the
 * target guild AND Scout is installed there." Mirrors the Discord-side
 * Discord command access is intentionally lightweight; management permissions
 * are enforced by the web UI's guild procedures.
 *
 * Both checks read application ports (`installed-guilds.ts` for installation,
 * `bot-rest.ts` for channels) rather than the gateway guild cache, so they
 * answer the same way whether or not this pod holds a gateway connection.
 */

import { TRPCError } from "@trpc/server";
import { ChannelType } from "discord.js";
import type { User } from "#generated/prisma/client/index.js";
import { hasAdministrator } from "#src/lib/discord-rest.ts";
import { botRest } from "#src/lib/discord/bot-rest.ts";
import { isScoutInstalledInGuild } from "#src/lib/discord/installed-guilds.ts";
import {
  callDiscordForRequest,
  fetchUserGuildsForRequest,
} from "#src/trpc/discord-upstream.ts";

/** Same open-integer reasoning as the picker's filter in `postable-channels.ts`. */
const POSTABLE_CHANNEL_TYPES = new Set<number>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
]);

export async function assertGuildAdmin(params: {
  user: User;
  guildId: string;
}): Promise<void> {
  // Throws UNAUTHORIZED / SERVICE_UNAVAILABLE if Discord can't be reached, so
  // the FORBIDDEN below only ever means a real membership answer.
  const guilds = await fetchUserGuildsForRequest(params.user);
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
  const installed = await callDiscordForRequest(() =>
    isScoutInstalledInGuild(params.guildId),
  );
  if (!installed) {
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
export async function assertChannelInGuild(params: {
  guildId: string;
  channelId: string;
}): Promise<void> {
  const channels = await callDiscordForRequest(() =>
    botRest().guildChannels(params.guildId),
  );
  if (channels === null) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Scout is not installed in that guild",
    });
  }
  const channel = channels.find(
    (candidate) => candidate.id === params.channelId,
  );
  if (channel === undefined) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Channel does not belong to that guild",
    });
  }
  if (!POSTABLE_CHANNEL_TYPES.has(channel.type)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Channel must be a text or announcement channel",
    });
  }
}
