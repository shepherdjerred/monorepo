/**
 * The bot-postable text channels of a guild, read from the gateway cache.
 *
 * Extracted from `guild.router.ts` because more than one surface has to offer
 * the same channel list — the dashboard picker and, separately, the Explore
 * agent when it prepares a create intent. Two copies of the filter would drift
 * into offering channels the bot cannot actually post in.
 */

import {
  ChannelType,
  PermissionFlagsBits,
  type GuildBasedChannel,
} from "discord.js";
import type { DiscordGuildId } from "@scout-for-lol/data";
import { client as discordClient } from "#src/discord/client.ts";

export type PostableChannel = {
  id: string;
  name: string;
  parentId: string | null;
};

/** Text channels in `guildId` that the bot can post to, sorted by name. */
export function listPostableChannels(
  guildId: DiscordGuildId,
): PostableChannel[] {
  const guild = discordClient.guilds.cache.get(guildId);
  if (guild === undefined) {
    // Callers have already proved Scout is installed, but the cache lookup is
    // still narrowed here for type-safety.
    return [];
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

  // Keep the response deterministic.
  channels.sort((a, b) => a.name.localeCompare(b.name));

  return channels;
}
