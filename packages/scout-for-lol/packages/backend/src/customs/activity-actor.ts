import { PermissionFlagsBits, type GuildMember } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type CustomActivityClaims,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { client as discordClient } from "#src/discord/client.ts";
import { assertCustomActivityPolicy } from "#src/customs/activity-auth.ts";

export type CustomActivityActor = {
  readonly discordId: DiscordAccountId;
  readonly guildId: DiscordGuildId;
  readonly channelId: DiscordChannelId;
  readonly guildName: string;
  readonly displayName: string;
  readonly avatarUrl: string | undefined;
  readonly administrator: boolean;
};

function actorForMember(
  member: GuildMember,
  claims: CustomActivityClaims,
): CustomActivityActor {
  return {
    discordId: DiscordAccountIdSchema.parse(claims.sub),
    guildId: DiscordGuildIdSchema.parse(claims.guildId),
    channelId: DiscordChannelIdSchema.parse(claims.channelId),
    guildName: member.guild.name,
    displayName: member.displayName,
    avatarUrl: member.displayAvatarURL() || undefined,
    administrator: member.permissions.has(PermissionFlagsBits.Administrator),
  };
}

export async function customActivityActor(
  claims: CustomActivityClaims,
): Promise<CustomActivityActor> {
  await assertCustomActivityPolicy(claims);
  const guild = discordClient.guilds.cache.get(claims.guildId);
  if (guild === undefined) {
    throw new Error("Scout is not installed in the Activity guild");
  }
  const member = await guild.members.fetch(claims.sub);
  return actorForMember(member, claims);
}

export async function customGuildMemberIdentity(
  actor: CustomActivityActor,
  discordId: string,
): Promise<{
  discordId: DiscordAccountId;
  displayName: string;
  avatarUrl: string | undefined;
}> {
  const guild = discordClient.guilds.cache.get(actor.guildId);
  if (guild === undefined) {
    throw new Error("Scout is not installed in the Activity guild");
  }
  const member = await guild.members.fetch(discordId);
  return {
    discordId: DiscordAccountIdSchema.parse(member.id),
    displayName: member.displayName,
    avatarUrl: member.displayAvatarURL() || undefined,
  };
}

export async function assertCustomLaunchChannel(
  actor: CustomActivityActor,
): Promise<void> {
  const guild = discordClient.guilds.cache.get(actor.guildId);
  if (guild === undefined) {
    throw new Error("Scout is not installed in the Activity guild");
  }
  const channel = await guild.channels.fetch(actor.channelId);
  if (channel?.isVoiceBased() !== true) {
    throw new Error(
      "Scout Customs must be launched from a guild voice channel",
    );
  }
}
