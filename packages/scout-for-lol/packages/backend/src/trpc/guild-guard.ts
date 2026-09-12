/**
 * Shared check for "the signed-in web user is an Administrator of the
 * target guild AND Scout is installed there." Mirrors the Discord-side
 * Discord command access is intentionally lightweight; management permissions
 * are enforced by the web UI's guild procedures.
 *
 * Both checks read application ports (`installed-guilds.ts` for installation,
 * `postable-channels.ts` — over `bot-rest.ts` — for channels) rather than the
 * gateway guild cache, so they answer the same way whether or not this pod
 * holds a gateway connection.
 */

import { TRPCError } from "@trpc/server";
import type { User } from "#generated/prisma/client/index.js";
import type { DiscordGuildId } from "@scout-for-lol/data";
import { hasAdministrator } from "#src/lib/discord-rest.ts";
import { isScoutInstalledInGuild } from "#src/lib/discord/installed-guilds.ts";
import { readGuildChannelPostability } from "#src/lib/discord/postable-channels.ts";
import {
  callDiscordForRequest,
  fetchUserGuildsForRequest,
} from "#src/trpc/discord-upstream.ts";

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
 * Verifies that `channelId` is a channel inside `guildId` that Scout can
 * actually post in. Without this, an admin of guild A could pass any channel ID
 * (even one belonging to guild B) into a subscription mutation and have
 * Scout's poll cycle later post into that foreign channel — `assertGuildAdmin`
 * alone is not enough because it only proves admin on the *requested* guild.
 *
 * The postability question goes through the SAME code the picker's filter does
 * ({@link readGuildChannelPostability}), rather than a second implementation of
 * it. Claiming to mirror the picker while checking only the channel *type* is
 * how this drifted: every mutation accepted channels the picker had refused on
 * permissions, and the resulting subscription was created successfully and then
 * never posted — a failure the user learns about by noticing nothing happens,
 * at a point where nothing connects it to the channel they picked.
 */
export async function assertChannelInGuild(params: {
  guildId: DiscordGuildId;
  channelId: string;
}): Promise<void> {
  const guild = await callDiscordForRequest(() =>
    readGuildChannelPostability(params.guildId),
  );
  if (guild === null) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Scout is not installed in that guild",
    });
  }
  const channel = guild.channels.find(
    (candidate) => candidate.id === params.channelId,
  );
  if (channel === undefined) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Channel does not belong to that guild",
    });
  }
  if (!guild.isPostable(channel)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Scout cannot post in that channel. Pick a text or announcement channel where Scout has View Channel and Send Messages.",
    });
  }
}
