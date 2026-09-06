/**
 * Voice Manager
 *
 * Manages Discord voice connections and audio playback. One connection per
 * guild, in one of two modes:
 *
 * - `"playback"` — the historical sound-engine mode: deafened, join-on-demand,
 *   alerts only.
 * - `"assistant"` — a Hey Scout session owns the connection: undeafened so the
 *   receiver works, entered only through `/scout join`, and never displaced by
 *   a playback request. Sound-engine alerts play into the assistant's channel
 *   instead of tearing it down.
 *
 * Leaving (manual `/scout leave`, auto-leave, or connection loss) clears the
 * mode, so the next playback join is deafened again.
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
import type { Client } from "discord.js";
import { createLogger } from "#src/logger.ts";
import type { SoundSource } from "@scout-for-lol/data";
import { getAudioStream } from "#src/voice/audio-player.ts";

const logger = createLogger("voice-manager");

export type ConnectionMode = "playback" | "assistant";

/**
 * What this manager needs from a live connection. `VoiceConnection` satisfies
 * it structurally; tests inject plain fakes through the `establish` seam.
 */
export type VoiceManagerConnection = {
  readonly state: { readonly status: VoiceConnectionStatus };
  readonly destroy: () => void;
  readonly subscribe: (player: AudioPlayer) => unknown;
};

/**
 * Joins the channel and resolves once the connection is usable. The
 * implementation owns transport details (fetching the channel, ready/timeouts,
 * reconnect races); `onConnectionLost` fires when a connection is gone for
 * good so the manager can forget it.
 */
export type EstablishVoiceConnection<C extends VoiceManagerConnection> =
  (input: {
    client: Client;
    guildId: string;
    channelId: string;
    selfDeaf: boolean;
    onConnectionLost: () => void;
  }) => Promise<C>;

/**
 * Consulted before each sound-engine alert. The voice-assistant output
 * arbiter installs one that waits for assistant speech to finish and ducks
 * the alert when it cannot.
 */
export type PlaybackGate = (
  guildId: string,
) => Promise<{ volumeMultiplier: number }>;

/**
 * Run `task` after every earlier task queued under `key` has settled, without
 * letting an earlier failure poison the queue. A guild's alerts share one
 * `AudioPlayer`, and `player.play()` replaces whatever the previous alert was
 * still playing — so concurrent alerts (including a batch the playback gate
 * releases together after assistant speech) must play one at a time or later
 * ones truncate earlier ones while every caller records success.
 */
export async function enqueuePerKey<T>(
  queues: Map<string, Promise<unknown>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  // Only never-rejecting tails are ever stored, so awaiting the predecessor
  // cannot throw — a failed alert already rejected its own caller via `run`.
  // An uncontended key starts its task synchronously, exactly like the
  // pre-queue behavior.
  const previous = queues.get(key);
  const run =
    previous === undefined
      ? task()
      : (async () => {
          await previous;
          return await task();
        })();
  const tail = (async () => {
    try {
      await run;
    } catch {
      // Swallowed so the NEXT task starts either way; `run` carries the
      // failure to this task's caller.
    }
  })();
  queues.set(key, tail);
  try {
    return await run;
  } finally {
    if (queues.get(key) === tail) {
      queues.delete(key);
    }
  }
}

/**
 * Manages voice connections and audio playback for Discord guilds
 */
export class VoiceManager<C extends VoiceManagerConnection> {
  private client: Client | null = null;
  private readonly connections = new Map<string, C>();
  private readonly players = new Map<string, AudioPlayer>();
  private readonly modes = new Map<string, ConnectionMode>();
  private readonly connectionLostListeners: ((
    guildId: string,
    mode: ConnectionMode,
  ) => void)[] = [];
  private readonly playbackQueues = new Map<string, Promise<unknown>>();
  private playbackGate: PlaybackGate | null = null;

  constructor(private readonly establish: EstablishVoiceConnection<C>) {}

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

  /** Notify when an established connection is lost (not on deliberate leaves). */
  onConnectionLost(
    listener: (guildId: string, mode: ConnectionMode) => void,
  ): void {
    this.connectionLostListeners.push(listener);
  }

  /** Installed once by the voice-assistant wiring; null means no arbitration. */
  setPlaybackGate(gate: PlaybackGate | null): void {
    this.playbackGate = gate;
  }

  getConnection(guildId: string): C | undefined {
    return this.connections.get(guildId);
  }

  getConnectionMode(guildId: string): ConnectionMode | undefined {
    return this.modes.get(guildId);
  }

  /**
   * Ensure connected to a voice channel for playback.
   *
   * Coexistence policy: an active assistant connection is NEVER destroyed or
   * displaced by a playback request — the alert plays into the assistant's
   * channel, whichever channel was asked for. Only a missing or non-ready
   * playback connection triggers a fresh join.
   */
  async ensureConnected(guildId: string, channelId: string): Promise<C> {
    if (!this.client) {
      throw new Error("Discord client not initialized");
    }

    const existingConnection = this.connections.get(guildId);
    if (
      existingConnection !== undefined &&
      this.modes.get(guildId) === "assistant" &&
      existingConnection.state.status !== VoiceConnectionStatus.Destroyed
    ) {
      return existingConnection;
    }
    if (existingConnection?.state.status === VoiceConnectionStatus.Ready) {
      return existingConnection;
    }

    return this.joinChannel(guildId, channelId);
  }

  /**
   * Join a voice channel.
   *
   * A playback join while an assistant session owns the guild's connection
   * returns the assistant connection untouched (see `ensureConnected`). An
   * assistant join always replaces whatever exists — `/scout join` is an
   * explicit user action and may move the bot between channels.
   */
  async joinChannel(
    guildId: string,
    channelId: string,
    mode: ConnectionMode = "playback",
  ): Promise<C> {
    if (!this.client) {
      throw new Error("Discord client not initialized");
    }

    const existingConnection = this.connections.get(guildId);
    if (
      existingConnection !== undefined &&
      mode === "playback" &&
      this.modes.get(guildId) === "assistant" &&
      existingConnection.state.status !== VoiceConnectionStatus.Destroyed
    ) {
      return existingConnection;
    }

    // Disconnect existing connection if any
    if (existingConnection !== undefined) {
      existingConnection.destroy();
      this.forget(guildId);
    }

    const connection = await this.establish({
      client: this.client,
      guildId,
      channelId,
      // The assistant must hear the channel; playback stays deafened so the
      // sound-engine bot never receives anyone's audio.
      selfDeaf: mode === "playback",
      onConnectionLost: () => {
        if (this.connections.get(guildId) !== connection) return;
        const lostMode = this.modes.get(guildId) ?? "playback";
        this.forget(guildId);
        logger.warn(`Voice connection lost for guild ${guildId}`);
        for (const listener of this.connectionLostListeners) {
          listener(guildId, lostMode);
        }
      },
    });

    this.connections.set(guildId, connection);
    this.modes.set(guildId, mode);
    logger.info(
      `Joined voice channel ${channelId} in guild ${guildId} (${mode})`,
    );
    return connection;
  }

  /**
   * Play a sound in a guild's voice channel.
   *
   * Alerts are serialized per guild: they share one `AudioPlayer`, and
   * `player.play()` replaces the in-flight resource, so overlapping calls —
   * including a batch released together by the playback gate — would truncate
   * each other while every caller records success. Each queued alert consults
   * the gate at its own turn, so one that reaches the head mid-reply still
   * waits or ducks on its own clock.
   */
  async playSound(
    guildId: string,
    source: SoundSource,
    volume = 1,
  ): Promise<void> {
    if (!this.connections.has(guildId)) {
      throw new Error(`No voice connection for guild ${guildId}`);
    }
    await enqueuePerKey(this.playbackQueues, guildId, async () => {
      await this.performPlaySound(guildId, source, volume);
    });
  }

  private async performPlaySound(
    guildId: string,
    source: SoundSource,
    volume: number,
  ): Promise<void> {
    // Let an in-flight assistant reply finish (bounded), or duck under it.
    const gate = await this.playbackGate?.(guildId);
    const effectiveVolume = volume * (gate?.volumeMultiplier ?? 1);

    // Re-fetched AFTER the gate wait on purpose: `/scout leave`, auto-leave,
    // a rejoin, or connection loss can destroy and replace the connection
    // while the gate holds this alert, and a player subscribed to the
    // captured stale object would play into nothing while the caller records
    // the alert as delivered. `forget()` clears the player map with the
    // connection, so this also never reuses a player bound to a dead one.
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
    resource.volume?.setVolume(effectiveVolume);

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
   * Leave a voice channel. Clears the guild's mode, so a later sound-engine
   * join comes back deafened and playback-only.
   */
  leaveChannel(guildId: string): void {
    const connection = this.connections.get(guildId);
    if (connection) {
      connection.destroy();
      this.forget(guildId);
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

  private forget(guildId: string): void {
    this.connections.delete(guildId);
    this.players.delete(guildId);
    this.modes.delete(guildId);
  }
}

/** The production transport: discord.js channel fetch + @discordjs/voice join. */
export const establishDiscordVoiceConnection: EstablishVoiceConnection<
  VoiceConnection
> = async ({ client, guildId, channelId, selfDeaf, onConnectionLost }) => {
  const channel = await client.channels.fetch(channelId);
  if (channel?.isVoiceBased() !== true) {
    throw new Error(`Channel ${channelId} is not a voice channel`);
  }

  // Discord.js isVoiceBased() is a type guard that narrows to VoiceBasedChannel
  // VoiceBasedChannel has the properties we need (id, guild, guild.voiceAdapterCreator)
  const voiceChannel = channel;

  // @discordjs/voice keeps its own per-guild registry; drop anything it still
  // tracks so the fresh join starts from a clean slate.
  getVoiceConnection(guildId)?.destroy();

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf,
    selfMute: false,
  });

  // Wait for connection to be ready
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  } catch (error) {
    connection.destroy();
    throw new Error(`Failed to connect to voice channel: ${String(error)}`, {
      cause: error,
    });
  }

  // Handle disconnections
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    void (async () => {
      try {
        // Try to reconnect
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        // Couldn't reconnect, clean up
        connection.destroy();
        onConnectionLost();
      }
    })();
  });

  return connection;
};

/**
 * Singleton voice manager instance
 */
export const voiceManager = new VoiceManager<VoiceConnection>(
  establishDiscordVoiceConnection,
);
