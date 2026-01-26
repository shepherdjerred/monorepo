import type { Client, VoiceState } from "discord.js";
import { recordVoiceActivity } from "../../database/repositories/activity.js";
import { loggers } from "../../utils/logger.js";

const logger = loggers.events.child("voice-state-update");

export function handleVoiceStateUpdate(client: Client) {
  client.on("voiceStateUpdate", (oldState: VoiceState, newState: VoiceState) => {
    try {
      // Ignore bot voice state changes
      if (newState.member?.user.bot) {
        return;
      }

      // Get guild ID (only track guild voice activity)
      const guildId = newState.guild.id;
      const userId = newState.id;

      // Determine the action based on state changes
      const oldChannelId = oldState.channelId;
      const newChannelId = newState.channelId;

      // No change in channel - could be mute/unmute/deafen, skip
      if (oldChannelId === newChannelId) {
        return;
      }

      if (!oldChannelId && newChannelId) {
        // User joined a voice channel
        recordVoiceActivity({
          guildId,
          userId,
          channelId: newChannelId,
          action: "join",
        });
        logger.debug("Voice join recorded", { guildId, userId, channelId: newChannelId });
      } else if (oldChannelId && !newChannelId) {
        // User left a voice channel
        recordVoiceActivity({
          guildId,
          userId,
          channelId: oldChannelId,
          action: "leave",
        });
        logger.debug("Voice leave recorded", { guildId, userId, channelId: oldChannelId });
      } else if (oldChannelId && newChannelId) {
        // User switched voice channels
        recordVoiceActivity({
          guildId,
          userId,
          channelId: newChannelId,
          action: "switch",
          previousChannelId: oldChannelId,
        });
        logger.debug("Voice switch recorded", {
          guildId,
          userId,
          fromChannel: oldChannelId,
          toChannel: newChannelId,
        });
      }
    } catch (error) {
      logger.error("Error in voice state update handler", error);
    }
  });
}
