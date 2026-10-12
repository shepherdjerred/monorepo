// Who is in the running game's voice channel, from the bot's gateway cache.
//
// The bot already holds the GuildVoiceStates intent (it ends a session when the
// channel empties), so this needs no extra intent and no REST call. Voice
// states, unlike `channel.members`, do not depend on the member cache.
import type { Client } from "discord.js";

export type VoiceChannelRef = { guildId: string; voiceChannelId: string };

export type VoicePresence = {
  /** Whether the user is in the channel right now. */
  isInChannel: (channel: VoiceChannelRef, discordId: string) => boolean;
  /** The channel's display name, for "join #name to play". */
  channelName: (channel: VoiceChannelRef) => string | undefined;
  /** The user's server nickname or display name, when they are in the guild cache. */
  displayName: (
    channel: VoiceChannelRef,
    discordId: string,
  ) => string | undefined;
};

export function botVoicePresence(bot: Client): VoicePresence {
  return {
    isInChannel(channel, discordId) {
      const guild = bot.guilds.cache.get(channel.guildId);
      return (
        guild?.voiceStates.cache.get(discordId)?.channelId ===
        channel.voiceChannelId
      );
    },
    channelName(channel) {
      const guild = bot.guilds.cache.get(channel.guildId);
      return guild?.channels.cache.get(channel.voiceChannelId)?.name;
    },
    displayName(channel, discordId) {
      const guild = bot.guilds.cache.get(channel.guildId);
      return guild?.voiceStates.cache.get(discordId)?.member?.displayName;
    },
  };
}
