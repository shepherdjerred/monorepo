import type { Client, VoiceState } from "discord.js";
import { loggers } from "../../utils/logger.js";
import {
  startVoiceReceiver,
  stopVoiceReceiver,
} from "../../voice/index.js";
import { getConfig } from "../../config/index.js";

const logger = loggers.discord.child("voice-state-update");

export function setupVoiceStateUpdateHandler(client: Client): void {
  client.on("voiceStateUpdate", (oldState: VoiceState, newState: VoiceState) => {
    const config = getConfig();

    // Handle when bot joins/leaves voice channels
    if (newState.member?.id === client.user?.id) {
      if (!oldState.channelId && newState.channelId) {
        logger.debug("Bot joined voice channel", {
          guildId: newState.guild.id,
          channelId: newState.channelId,
        });

        // Start voice receiver if voice is enabled
        if (config.voice.enabled) {
          void startVoiceReceiver(newState.guild.id);
        }
      } else if (oldState.channelId && !newState.channelId) {
        logger.debug("Bot left voice channel", {
          guildId: newState.guild.id,
          channelId: oldState.channelId,
        });

        // Stop voice receiver
        stopVoiceReceiver(newState.guild.id);
      }
    }
  });
}
