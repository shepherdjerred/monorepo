import type { Client, VoiceState } from "discord.js";
import { loggers } from "../../utils/logger.js";
import {
  startVoiceReceiver,
  stopVoiceReceiver,
} from "../../voice/index.js";
import { getConfig } from "../../config/index.js";
import { recordVoiceActivity } from "../../database/repositories/activity.js";

const logger = loggers.discord.child("voice-state-update");

// Track voice session start times for duration calculation
// Key: `${guildId}:${userId}:${channelId}`
const voiceSessionStarts = new Map<string, number>();

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

    // Track user voice activity (ignore bots)
    if (!newState.member || newState.member.user.bot) {
      return;
    }

    const userId = newState.member.id;
    const guildId = newState.guild.id;

    // User joined a voice channel
    if (!oldState.channelId && newState.channelId) {
      const sessionKey = `${guildId}:${userId}:${newState.channelId}`;
      voiceSessionStarts.set(sessionKey, Date.now());

      logger.debug("User joined voice channel", {
        guildId,
        userId,
        channelId: newState.channelId,
      });
    }
    // User left a voice channel
    else if (oldState.channelId && !newState.channelId) {
      const sessionKey = `${guildId}:${userId}:${oldState.channelId}`;
      const joinTime = voiceSessionStarts.get(sessionKey);

      if (joinTime) {
        const durationMs = Date.now() - joinTime;
        const durationMinutes = Math.floor(durationMs / (1000 * 60));

        if (durationMinutes > 0) {
          recordVoiceActivity({
            guildId,
            userId,
            channelId: oldState.channelId,
            durationMinutes,
          });

          logger.debug("User left voice channel", {
            guildId,
            userId,
            channelId: oldState.channelId,
            durationMinutes,
          });
        }

        voiceSessionStarts.delete(sessionKey);
      }
    }
    // User moved between voice channels
    else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      // Record activity for the old channel
      const oldSessionKey = `${guildId}:${userId}:${oldState.channelId}`;
      const joinTime = voiceSessionStarts.get(oldSessionKey);

      if (joinTime) {
        const durationMs = Date.now() - joinTime;
        const durationMinutes = Math.floor(durationMs / (1000 * 60));

        if (durationMinutes > 0) {
          recordVoiceActivity({
            guildId,
            userId,
            channelId: oldState.channelId,
            durationMinutes,
          });
        }

        voiceSessionStarts.delete(oldSessionKey);
      }

      // Start tracking the new channel
      const newSessionKey = `${guildId}:${userId}:${newState.channelId}`;
      voiceSessionStarts.set(newSessionKey, Date.now());

      logger.debug("User moved voice channels", {
        guildId,
        userId,
        oldChannelId: oldState.channelId,
        newChannelId: newState.channelId,
      });
    }
  });
}
