/**
 * The bot-postable text channels of a guild, read over the bot REST API.
 *
 * Extracted from `guild.router.ts` because more than one surface has to offer
 * the same channel list — the dashboard picker and, separately, the Explore
 * agent when it prepares a create intent. Two copies of the filter would drift
 * into offering channels the bot cannot actually post in.
 *
 * The filter needs Scout's *effective* permissions in each channel, which the
 * gateway used to compute for us. Over REST that means three reads — the
 * guild's channels, its roles, and Scout's own member row — combined by
 * `channel-permissions.ts`. All three are TTL-cached per guild, so a picker
 * render is at most three Discord requests and usually none.
 */

import { ChannelType, PermissionFlagsBits } from "discord.js";
import type { DiscordGuildId } from "@scout-for-lol/data";
import { botRest, type BotRestReader } from "#src/lib/discord/bot-rest.ts";
import {
  computeChannelPermissions,
  hasPermission,
} from "#src/lib/discord/channel-permissions.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("discord-postable-channels");

export type PostableChannel = {
  id: string;
  name: string;
  parentId: string | null;
};

export type PostableChannelDependencies = {
  readonly rest: BotRestReader;
};

function defaultDependencies(): PostableChannelDependencies {
  return { rest: botRest() };
}

/**
 * The channel types Scout can post reports into. A `Set<number>` rather than
 * enum comparisons because Discord's wire `type` is an open integer: a channel
 * kind added tomorrow must be *skipped*, not crash the picker.
 */
const POSTABLE_CHANNEL_TYPES = new Set<number>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
]);

/**
 * Text channels in `guildId` that the bot can post to, sorted by name.
 *
 * Returns `[]` when Discord says Scout is not in the guild — callers have
 * already proved installation, so that is a narrowing, not a decision. A
 * failure to reach Discord throws {@link DiscordUpstreamError} instead, so an
 * outage is never presented as "this server has no channels".
 */
export async function listPostableChannels(
  guildId: DiscordGuildId,
  dependencies: PostableChannelDependencies = defaultDependencies(),
): Promise<PostableChannel[]> {
  const { rest } = dependencies;
  const [channels, roles, me] = await Promise.all([
    rest.guildChannels(guildId),
    rest.guildRoles(guildId),
    rest.botMember(guildId),
  ]);
  if (channels === null || roles === null || me === null) {
    logger.warn("Discord reports Scout is not in the guild", { guildId });
    return [];
  }

  const rolePermissions = new Map(
    roles.map((role) => [role.id, role.permissions]),
  );
  const postable = channels
    .filter((channel) => {
      if (!POSTABLE_CHANNEL_TYPES.has(channel.type)) return false;
      // Only offer channels the bot can actually post in. Without this we'd
      // show channels Scout could read but never message.
      const permissions = computeChannelPermissions({
        guildId,
        // A bot can never own a guild, so the owner grant cannot apply here.
        guildOwnerId: null,
        memberId: me.user.id,
        memberRoleIds: me.roles,
        rolePermissions,
        overwrites: channel.permission_overwrites,
      });
      return (
        hasPermission(permissions, PermissionFlagsBits.ViewChannel) &&
        hasPermission(permissions, PermissionFlagsBits.SendMessages)
      );
    })
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      parentId: channel.parent_id ?? null,
    }));

  // Keep the response deterministic.
  postable.sort((a, b) => a.name.localeCompare(b.name));

  return postable;
}
