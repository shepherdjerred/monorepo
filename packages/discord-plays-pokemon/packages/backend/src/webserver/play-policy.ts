import type { Client } from "discord.js";
import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";
import { avatarUrl } from "@shepherdjerred/discord-plays-core/auth/discord-oauth.ts";
import type {
  VoiceChannelRef,
  VoicePresence,
} from "@shepherdjerred/discord-plays-core/auth/voice-presence.ts";
import type { PlayBlocker } from "@discord-plays-pokemon/common";

export type PlayPolicy = {
  players: () => DiscordUser[];
  voiceChannelName: () => string | null;
  blockerFor: (user: DiscordUser | undefined) => PlayBlocker | null;
  canWatch: (user: DiscordUser | undefined) => boolean;
  minimumInChannel: number;
};

/** Read current voice state for every decision; browser identity never names a channel. */
export function createPlayPolicy({
  channel,
  voice,
  players,
  minimumInChannel,
}: {
  channel: () => VoiceChannelRef | undefined;
  voice: VoicePresence;
  players: () => DiscordUser[];
  minimumInChannel: number;
}): PlayPolicy {
  return {
    players,
    minimumInChannel,
    voiceChannelName: () => {
      const current = channel();
      return current === undefined
        ? null
        : (voice.channelName(current) ?? null);
    },
    blockerFor: (user) => {
      const current = channel();
      if (current === undefined) return "no-session";
      if (user === undefined) return "signed-out";
      if (!voice.isInChannel(current, user.discordId)) return "not-in-voice";
      return players().length < minimumInChannel ? "too-few-players" : null;
    },
    canWatch: (user) => {
      const current = channel();
      return (
        current !== undefined &&
        user !== undefined &&
        voice.isInChannel(current, user.discordId)
      );
    },
  };
}

export function playersInVoice(
  bot: Client,
  channel: VoiceChannelRef | undefined,
  excludedUserIds: ReadonlySet<string>,
): DiscordUser[] {
  if (channel === undefined) return [];
  const guild = bot.guilds.cache.get(channel.guildId);
  return guild === undefined
    ? []
    : humanPlayersInVoice(
        guild.voiceStates.cache.values(),
        channel.voiceChannelId,
        excludedUserIds,
      );
}

type VoicePlayer = {
  id: string;
  channelId: string | null;
  member?: {
    user: { bot: boolean; username: string; avatar: string | null };
    displayName: string;
  } | null;
};

/** Streaming userbots are ordinary Discord users, so exclude their IDs explicitly. */
export function humanPlayersInVoice(
  states: Iterable<VoicePlayer>,
  channelId: string,
  excludedUserIds: ReadonlySet<string>,
): DiscordUser[] {
  return [...states]
    .filter(
      (state) =>
        state.channelId === channelId &&
        !excludedUserIds.has(state.id) &&
        state.member?.user.bot !== true,
    )
    .map((state) => ({
      discordId: state.id,
      username: state.member?.user.username ?? state.id,
      name: state.member?.displayName ?? state.id,
      avatarUrl: avatarUrl(state.id, state.member?.user.avatar ?? null),
    }));
}
