/**
 * Voice Manager
 *
 * Manages Discord voice connections and audio playback.
 */

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  type VoiceConnection,
  type AudioPlayer,
} from "@discordjs/voice";
import type { Client, VoiceChannel } from "discord.js";
import { createLogger } from "@scout-for-lol/backend/logger.ts";
import type { SoundSource } from "@scout-for-lol/data";
import { getAudioStream } from "@scout-for-lol/backend/voice/audio-player.ts";

const logger = createLogger("voice-manager");

/**
 * Manages voice connections and audio playback for Discord guilds
 */
export class VoiceManager {
  private client: Client | null = null;
  private connections = new Map<string, VoiceConnection>();
  private players = new Map<string, AudioPlayer>();

  /**
   * Initialize with Discord client
   */
  setClient(client: Client): void {
    this.client = client;
    logger.info("Voice manager initialized with Discord client");
  }

  /**
   * Get the Discord client
   */
  getClient(): Client | null {
    return this.client;
  }

  /**
   * Ensure connected to a voice channel
   */
  async ensureConnected(
    guildId: string,
    channelId: string,
  ): Promise<VoiceConnection> {
    if (!this.client) {
      throw new Error("Discord client not initialized");
    }

    const existingConnection = this.connections.get(guildId);
    if (existingConnection?.state.status === VoiceConnectionStatus.Ready) {
      return existingConnection;
    }

    return this.joinChannel(guildId, channelId);
  }

  /**
   * Join a voice channel
   */
  async joinChannel(
    guildId: string,
    channelId: string,
  ): Promise<VoiceConnection> {
    if (!this.client) {
      throw new Error("Discord client not initialized");
    }

    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isVoiceBased()) {
      throw new Error(`Channel ${channelId} is not a voice channel`);
    }

    // channel.isVoiceBased() ensures this is a voice channel
    // eslint-disable-next-line custom-rules/no-type-assertions -- Discord.js type narrowing doesn't properly narrow isVoiceBased()
    const voiceChannel = channel as unknown as VoiceChannel;

    // Disconnect existing connection if any
    const existingConnection = getVoiceConnection(guildId);
    if (existingConnection) {
      existingConnection.destroy();
      this.connections.delete(guildId);
      this.players.delete(guildId);
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    // Wait for connection to be ready
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (error) {
      connection.destroy();
      throw new Error(`Failed to connect to voice channel: ${String(error)}`);
    }

    this.connections.set(guildId, connection);
    logger.info(
      `Joined voice channel ${voiceChannel.name} in guild ${guildId}`,
    );

    // Handle disconnections
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      void (async () => {
        try {
          // Try to reconnect
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          // Couldn't reconnect, clean up
          connection.destroy();
          this.connections.delete(guildId);
          this.players.delete(guildId);
          logger.warn(`Voice connection lost for guild ${guildId}`);
        }
      })();
    });

    return connection;
  }

  /**
   * Play a sound in a guild's voice channel
   */
  async playSound(
    guildId: string,
    source: SoundSource,
    volume = 1.0,
  ): Promise<void> {
    const connection = this.connections.get(guildId);
    if (!connection) {
      throw new Error(`No voice connection for guild ${guildId}`);
    }

    // Get or create audio player for this guild
    let player = this.players.get(guildId);
    if (!player) {
      player = createAudioPlayer();
      this.players.set(guildId, player);
      connection.subscribe(player);

      // Handle player state changes
      player.on("error", (error) => {
        logger.error("Audio player error:", error);
      });
    }

    // Get audio stream based on source type
    const stream = await getAudioStream(source);
    const resource = createAudioResource(stream, {
      inlineVolume: true,
    });
    resource.volume?.setVolume(volume);

    // Play the audio
    player.play(resource);

    // Wait for completion or error
    const audioPlayer = player;
    return new Promise((resolve, reject) => {
      const onIdle = () => {
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        cleanup();
        logger.error("Audio playback error:", error);
        reject(error);
      };

      const cleanup = () => {
        audioPlayer.off(AudioPlayerStatus.Idle, onIdle);
        audioPlayer.off("error", onError);
      };

      audioPlayer.once(AudioPlayerStatus.Idle, onIdle);
      audioPlayer.once("error", onError);

      // Timeout after 60 seconds
      setTimeout(() => {
        cleanup();
        resolve();
      }, 60_000);
    });
  }

  /**
   * Leave a voice channel
   */
  leaveChannel(guildId: string): void {
    const connection = this.connections.get(guildId);
    if (connection) {
      connection.destroy();
      this.connections.delete(guildId);
      this.players.delete(guildId);
      logger.info(`Left voice channel in guild ${guildId}`);
    }
  }

  /**
   * Leave all voice channels
   */
  leaveAll(): void {
    for (const guildId of this.connections.keys()) {
      this.leaveChannel(guildId);
    }
  }

  /**
   * Check if connected to a guild's voice channel
   */
  isConnected(guildId: string): boolean {
    const connection = this.connections.get(guildId);
    return connection?.state.status === VoiceConnectionStatus.Ready;
  }
}

/**
 * Singleton voice manager instance
 */
export const voiceManager = new VoiceManager();
