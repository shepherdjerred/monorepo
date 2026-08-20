import { ChannelType } from "discord.js";
import type {
  CustomGameParticipant,
  CustomNightSnapshot,
} from "@scout-for-lol/data";
import { customsDiscordClient } from "#src/customs/discord-client.ts";
import {
  runCustomVoiceOperation,
  errorMessage,
} from "#src/customs/voice-utils.ts";
import {
  isMissingChannelError,
  isMissingMemberError,
} from "#src/discord/utils/permissions.ts";

export type CustomVoiceReturnTarget = {
  guildId: string;
  voiceLobbyChannelId: string;
  teamAVoiceChannelId: string | null;
  teamBVoiceChannelId: string | null;
  currentGame: {
    participants: Pick<CustomGameParticipant, "discordId" | "displayName">[];
  } | null;
};

async function cleanupCustomVoiceOperation(
  snapshot: CustomNightSnapshot,
  pendingResultVoiceTargets: readonly CustomVoiceReturnTarget[],
): Promise<string[]> {
  const guild = await customsDiscordClient.guilds.fetch(snapshot.guildId);
  const lobby = await guild.channels
    .fetch(snapshot.voiceLobbyChannelId)
    .then((channel) => {
      if (channel === null) return null;
      if (channel.type !== ChannelType.GuildVoice)
        throw new Error(
          "The configured Customs voice lobby is not a guild voice channel",
        );
      return channel;
    })
    .catch((error) => {
      if (isMissingChannelError(error)) return null;
      throw error;
    });
  const ownedIds = new Set(
    [
      snapshot.teamAVoiceChannelId,
      snapshot.teamBVoiceChannelId,
      ...pendingResultVoiceTargets.flatMap((target) => [
        target.teamAVoiceChannelId,
        target.teamBVoiceChannelId,
      ]),
    ].filter((channelId) => channelId !== null),
  );
  const participants = new Map<
    string,
    { discordId: string; displayName: string }
  >();
  for (const participant of snapshot.currentGame?.participants ?? [])
    participants.set(participant.discordId, participant);
  for (const target of pendingResultVoiceTargets) {
    for (const participant of target.currentGame?.participants ?? [])
      participants.set(participant.discordId, participant);
  }
  const failures: string[] = [];
  for (const participant of participants.values()) {
    try {
      const member = await guild.members.fetch(participant.discordId);
      if (
        lobby !== null &&
        member.voice.channelId !== null &&
        ownedIds.has(member.voice.channelId)
      ) {
        await member.voice.setChannel(lobby, "Scout Customs night ended");
      }
    } catch (error) {
      if (isMissingMemberError(error)) continue;
      failures.push(`${participant.displayName}: ${errorMessage(error)}`);
    }
  }
  if (failures.length > 0) return failures;
  for (const channelId of ownedIds) {
    try {
      const channel = await guild.channels.fetch(channelId);
      if (channel !== null) await channel.delete("Scout Customs night ended");
    } catch (error) {
      if (isMissingChannelError(error)) continue;
      failures.push(`channel ${channelId}: ${errorMessage(error)}`);
    }
  }
  return failures;
}

export async function cleanupCustomVoice(
  snapshot: CustomNightSnapshot,
  pendingResultVoiceTargets: readonly CustomVoiceReturnTarget[] = [],
): Promise<string[]> {
  return await runCustomVoiceOperation(
    snapshot.id,
    async () =>
      await cleanupCustomVoiceOperation(snapshot, pendingResultVoiceTargets),
  );
}

async function returnCustomPlayersToLobbyOperation(
  snapshot: CustomVoiceReturnTarget,
): Promise<string[]> {
  const guild = await customsDiscordClient.guilds.fetch(snapshot.guildId);
  const lobby = await guild.channels.fetch(snapshot.voiceLobbyChannelId);
  if (lobby?.type !== ChannelType.GuildVoice)
    throw new Error(
      "The configured Customs voice lobby is not a guild voice channel",
    );
  const ownedIds = new Set(
    [snapshot.teamAVoiceChannelId, snapshot.teamBVoiceChannelId].filter(
      (channelId) => channelId !== null,
    ),
  );
  const failures: string[] = [];
  for (const participant of snapshot.currentGame?.participants ?? []) {
    try {
      const member = await guild.members.fetch(participant.discordId);
      if (
        member.voice.channelId !== null &&
        ownedIds.has(member.voice.channelId)
      ) {
        await member.voice.setChannel(lobby, "Scout Customs intermission");
      }
    } catch (error) {
      if (isMissingMemberError(error)) continue;
      failures.push(`${participant.displayName}: ${errorMessage(error)}`);
    }
  }
  return failures;
}

export async function returnCustomPlayersToLobby(
  snapshot: CustomVoiceReturnTarget,
  nightId: string,
): Promise<string[]> {
  return await runCustomVoiceOperation(
    nightId,
    async () => await returnCustomPlayersToLobbyOperation(snapshot),
  );
}
