import {
  ApplicationCommandType,
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
} from "discord.js";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";
import type { CustomActivityClaims } from "@scout-for-lol/data";
import type { CustomActor } from "#src/customs/service.ts";

const logger = createLogger("customs-discord");
const DiscordApiErrorSchema = z.object({ code: z.number() });
const EXPECTED_ACCESS_ERROR_CODES = new Set([
  10_003, 10_004, 10_007, 50_001, 50_013,
]);

async function withCustomDiscordAccess<T>(
  claims: CustomActivityClaims,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const parsed = DiscordApiErrorSchema.safeParse(error);
    if (parsed.success && EXPECTED_ACCESS_ERROR_CODES.has(parsed.data.code)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Scout Customs no longer has access to this guild context",
        cause: error,
      });
    }
    logger.error("Discord guild access check failed", {
      error,
      discordId: claims.sub,
      guildId: claims.guildId,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Discord guild validation is temporarily unavailable",
      cause: error,
    });
  }
}

export const customsDiscordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

export async function startCustomsDiscord(): Promise<void> {
  const config = configuration.customs;
  if (config === undefined) {
    logger.info(
      "Scout Customs Discord application is disabled in this environment",
    );
    return;
  }
  const rest = new REST({ version: "10" }).setToken(config.botToken);
  await rest.put(Routes.applicationCommands(config.applicationId), {
    body: [
      {
        name: "Customs",
        description: "Start or join a Scout custom-game night",
        type: ApplicationCommandType.PrimaryEntryPoint,
        handler: 2,
      },
    ],
  });
  await customsDiscordClient.login(config.botToken);
  logger.info("Scout Customs Discord application connected");
}

export async function stopCustomsDiscord(): Promise<void> {
  await customsDiscordClient.destroy();
}

export async function customActorForSession(
  claims: CustomActivityClaims,
): Promise<CustomActor> {
  return await withCustomDiscordAccess(claims, async () => {
    const guild = await customsDiscordClient.guilds.fetch(claims.guildId);
    const member = await guild.members.fetch(claims.sub);
    return {
      discordId: claims.sub,
      discordAdministrator:
        guild.ownerId === claims.sub ||
        member.permissions.has(PermissionFlagsBits.Administrator),
    };
  });
}

export async function assertCustomGuildMember(
  claims: CustomActivityClaims,
): Promise<void> {
  await withCustomDiscordAccess(claims, async () => {
    const guild = await customsDiscordClient.guilds.fetch(claims.guildId);
    await guild.members.fetch(claims.sub);
  });
}

export async function customMemberIdentity(
  claims: CustomActivityClaims,
): Promise<{
  displayName: string;
  avatarUrl: string | null;
  guildName: string;
}> {
  return await withCustomDiscordAccess(claims, async () => {
    const guild = await customsDiscordClient.guilds.fetch(claims.guildId);
    const member = await guild.members.fetch(claims.sub);
    return {
      displayName: member.displayName,
      avatarUrl: member.displayAvatarURL(),
      guildName: guild.name,
    };
  });
}

export async function customVoiceChannels(
  claims: CustomActivityClaims,
): Promise<{ id: string; name: string }[]> {
  return await withCustomDiscordAccess(claims, async () => {
    const guild = await customsDiscordClient.guilds.fetch(claims.guildId);
    const member = await guild.members.fetch(claims.sub);
    const channels = await guild.channels.fetch();
    const visibleChannels: { id: string; name: string }[] = [];
    for (const channel of channels.values()) {
      if (
        channel !== null &&
        channel.type === ChannelType.GuildVoice &&
        channel
          .permissionsFor(member)
          .has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])
      ) {
        visibleChannels.push({ id: channel.id, name: channel.name });
      }
    }
    return visibleChannels.toSorted((left, right) =>
      left.name.localeCompare(right.name),
    );
  });
}

export async function assertCustomVoiceChannelAccess(
  claims: CustomActivityClaims,
  channelId: string,
): Promise<void> {
  await withCustomDiscordAccess(claims, async () => {
    const guild = await customsDiscordClient.guilds.fetch(claims.guildId);
    const member = await guild.members.fetch(claims.sub);
    const channel = await guild.channels.fetch(channelId);
    if (
      channel?.type !== ChannelType.GuildVoice ||
      !channel
        .permissionsFor(member)
        .has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Selected voice lobby is not available to this member",
      });
    }
  });
}
