import { ChannelType, type Guild, type VoiceChannel } from "discord.js";
import type { CustomNightSnapshot } from "@scout-for-lol/data";
import { errorMessage } from "#src/customs/voice-utils.ts";

export class PartialTeamChannelsError extends Error {
  constructor(
    readonly teamA: VoiceChannel,
    message: string,
  ) {
    super(message);
    this.name = "PartialTeamChannelsError";
  }
}

export async function deleteCreatedTeamChannels(channels: {
  teamA: VoiceChannel;
  teamB?: VoiceChannel;
}): Promise<string[]> {
  const failures: string[] = [];
  for (const channel of [channels.teamA, channels.teamB].flatMap((candidate) =>
    candidate === undefined ? [] : [candidate],
  )) {
    try {
      await channel.delete("Scout Customs voice arrangement did not commit");
    } catch (error) {
      failures.push(`channel ${channel.id}: ${errorMessage(error)}`);
    }
  }
  return failures;
}

export async function deleteRecordedTeamChannels(
  guild: Guild,
  channelIds: readonly string[],
): Promise<void> {
  const failures: string[] = [];
  for (const channelId of channelIds) {
    try {
      const channel = await guild.channels.fetch(channelId);
      if (channel === null) continue;
      if (channel.type !== ChannelType.GuildVoice) {
        throw new Error("Recorded Customs channel is not a voice channel");
      }
      await channel.delete("Scout Customs voice channel recovery");
    } catch (error) {
      failures.push(`channel ${channelId}: ${errorMessage(error)}`);
    }
  }
  if (failures.length > 0)
    throw new Error(
      `Recorded voice channel cleanup failed: ${failures.join("; ")}`,
    );
}

export async function moveDraftedPlayers(params: {
  guild: Guild;
  snapshot: CustomNightSnapshot;
  teamA: VoiceChannel;
  teamB: VoiceChannel;
}): Promise<string[]> {
  const game = params.snapshot.currentGame;
  if (game === null) throw new Error("There is no current custom game");
  const allowedSourceIds = new Set([
    params.snapshot.voiceLobbyChannelId,
    params.teamA.id,
    params.teamB.id,
  ]);
  const failures: string[] = [];
  for (const participant of game.participants) {
    if (participant.team === null)
      throw new Error("Cannot arrange voice before teams are complete");
    try {
      const member = await params.guild.members.fetch(participant.discordId);
      if (
        member.voice.channelId !== null &&
        allowedSourceIds.has(member.voice.channelId)
      ) {
        await member.voice.setChannel(
          participant.team === "A" ? params.teamA : params.teamB,
          "Scout Customs team assignment",
        );
      }
    } catch (error) {
      failures.push(`${participant.displayName}: ${errorMessage(error)}`);
    }
  }
  return failures;
}
