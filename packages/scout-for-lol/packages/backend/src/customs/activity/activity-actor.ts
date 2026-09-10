/**
 * Who is acting inside a Scout Customs Activity, resolved for an HTTP request.
 *
 * Every Discord fact here comes from the bot REST ports rather than the gateway
 * guild cache, so the Activity's API answers identically on a pod with no
 * gateway connection. `customsDiscordRead` keeps "Discord is unreachable" (503)
 * apart from "you are not in this server" (403).
 */

import { ChannelType, PermissionFlagsBits } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type CustomActivityClaims,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  CustomAuthHttpError,
  assertCustomActivityPolicy,
  customsDiscordRead,
} from "#src/customs/activity/activity-auth.ts";
import {
  botRest,
  memberAvatarUrl,
  memberDisplayName,
} from "#src/lib/discord/bot-rest.ts";
import { installedGuildName } from "#src/lib/discord/installed-guilds.ts";
import {
  computeChannelPermissions,
  hasPermission,
} from "#src/lib/discord/channel-permissions.ts";
import type { DiscordGuildMember } from "#src/lib/discord/bot-rest-schemas.ts";

export type CustomActivityActor = {
  readonly discordId: DiscordAccountId;
  readonly guildId: DiscordGuildId;
  readonly channelId: DiscordChannelId;
  readonly guildName: string;
  readonly displayName: string;
  readonly avatarUrl: string | undefined;
  readonly administrator: boolean;
};

/**
 * Whether the member holds Administrator guild-wide.
 *
 * The gateway used to hand this over as `member.permissions`; over REST the
 * member payload carries role ids only, so the roles have to be joined against
 * the guild's role list.
 */
async function hasGuildAdministrator(
  guildId: DiscordGuildId,
  member: DiscordGuildMember,
): Promise<boolean> {
  const roles = await customsDiscordRead(
    () => botRest().guildRoles(guildId),
    "Scout could not read this server's roles right now",
  );
  if (roles === null) return false;
  const permissions = computeChannelPermissions({
    guildId,
    memberId: member.user.id,
    memberRoleIds: member.roles,
    rolePermissions: new Map(roles.map((role) => [role.id, role.permissions])),
    // No channel context: this is the guild-wide answer.
    overwrites: [],
  });
  return hasPermission(permissions, PermissionFlagsBits.Administrator);
}

async function requireGuildMember(
  guildId: DiscordGuildId,
  discordId: string,
): Promise<DiscordGuildMember> {
  const member = await customsDiscordRead(
    () => botRest().guildMember(guildId, discordId),
    "Scout could not verify this server's members right now",
  );
  if (member === null) {
    throw new CustomAuthHttpError(403, "Activity guild membership required");
  }
  return member;
}

export async function customActivityActor(
  claims: CustomActivityClaims,
): Promise<CustomActivityActor> {
  await assertCustomActivityPolicy(claims);
  const guildId = DiscordGuildIdSchema.parse(claims.guildId);
  const member = await requireGuildMember(guildId, claims.sub);
  return {
    discordId: DiscordAccountIdSchema.parse(claims.sub),
    guildId,
    channelId: DiscordChannelIdSchema.parse(claims.channelId),
    guildName: (await installedGuildName(guildId)) ?? guildId,
    displayName: memberDisplayName(member),
    avatarUrl: memberAvatarUrl(member, guildId),
    administrator: await hasGuildAdministrator(guildId, member),
  };
}

export async function customGuildMemberIdentity(
  actor: CustomActivityActor,
  discordId: string,
): Promise<{
  discordId: DiscordAccountId;
  displayName: string;
  avatarUrl: string | undefined;
}> {
  const member = await requireGuildMember(actor.guildId, discordId);
  return {
    discordId: DiscordAccountIdSchema.parse(member.user.id),
    displayName: memberDisplayName(member),
    avatarUrl: memberAvatarUrl(member, actor.guildId),
  };
}

/** Voice-shaped channel kinds an Activity may legitimately launch from. */
const LAUNCHABLE_CHANNEL_TYPES = new Set<number>([
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);

/**
 * The channel the Activity was launched from must be a voice channel of the
 * claimed guild.
 *
 * Read by id and uncached: the id comes from Discord's Activity SDK, not from a
 * list Scout offered, and people routinely create a voice channel and launch
 * Customs in it moments later — a cached channel list would reject a channel
 * that provably exists. `guild_id` is checked here because the by-id route is
 * not guild-scoped.
 */
export async function assertCustomLaunchChannel(
  actor: CustomActivityActor,
): Promise<void> {
  const channel = await customsDiscordRead(
    () => botRest().channel(actor.channelId),
    "Scout could not read that channel right now",
  );
  if (
    channel?.guild_id !== actor.guildId ||
    !LAUNCHABLE_CHANNEL_TYPES.has(channel.type)
  ) {
    throw new Error(
      "Scout Customs must be launched from a guild voice channel",
    );
  }
}
