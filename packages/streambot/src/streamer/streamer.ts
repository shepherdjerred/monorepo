import { Client } from "discord.js-selfbot-v13";
import {
  Encoders,
  Streamer,
  Utils,
  createSeekablePlayer,
  type Player,
} from "@shepherdjerred/discord-video-stream";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type {
  JoinVoiceInput,
  LeaveVoiceInput,
  RunStreamInput,
  VoiceHandle,
} from "@shepherdjerred/streambot/machine/types.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("streamer");

/**
 * Owns the selfbot voice connection and ffmpeg streaming via `@shepherdjerred/discord-video-stream`
 * (our fork). Its methods are the playback machine's `joinVoice` / `runStream` / `leaveVoice`
 * actors, so all voice I/O is driven by — and cancellable from — the machine. Uses Intel VAAPI
 * hardware encoding when enabled, falling back to software if the device/driver is unavailable.
 *
 * Live controls (`setVolume`, `seek`) act on the currently-playing {@link Player} as side-channels,
 * independent of the machine.
 */
export class StreambotStreamer {
  private readonly client: Client;
  private readonly streamer: Streamer;
  private readonly config: Config;
  private player: Player | null = null;
  /** Last known playback offset (seconds), captured per segment so a HW→SW retry can resume there. */
  private lastPlaybackPositionSeconds = 0;

  constructor(config: Config) {
    this.config = config;
    this.client = new Client();
    this.streamer = new Streamer(this.client);
  }

  async login(): Promise<void> {
    await this.client.login(this.config.discord.userToken);
    log.info("streamer logged in", { user: this.client.user?.username });
  }

  /** Discord user id of the logged-in streamer (for the alone-in-VC check), or null. */
  userId(): string | null {
    return this.client.user?.id ?? null;
  }

  async destroy(): Promise<void> {
    this.safeStop();
    try {
      this.client.destroy();
    } catch (error) {
      // discord.js-selfbot-v13's destroy throws (`this.connection.readyState` on null) when the
      // gateway shard never fully opened or already closed — harmless during shutdown.
      log.warn("client destroy failed", { error: getErrorMessage(error) });
    }
    await Promise.resolve();
  }

  /** Apply a volume percentage (0-200) to the live stream; false when nothing is playing. */
  async setVolume(percent: number): Promise<boolean> {
    if (this.player === null) {
      return false;
    }
    return this.player.setVolume(Math.max(0, percent) / 100);
  }

  /** Seek the live stream to an absolute offset (seconds); false when nothing is playing. */
  async seek(seconds: number): Promise<boolean> {
    if (this.player === null) {
      return false;
    }
    await this.player.seek(seconds);
    return true;
  }

  private safeStop(): void {
    try {
      this.player?.stop();
    } catch (error) {
      log.warn("player stop failed", { error: getErrorMessage(error) });
    }
    this.player = null;
    try {
      this.streamer.stopStream();
    } catch (error) {
      log.warn("stopStream failed", { error: getErrorMessage(error) });
    }
    try {
      this.streamer.leaveVoice();
    } catch (error) {
      log.warn("leaveVoice failed", { error: getErrorMessage(error) });
    }
  }

  readonly joinVoice = async (input: JoinVoiceInput): Promise<VoiceHandle> => {
    await this.streamer.joinVoice(input.guildId, input.channelId);
    log.info("joined voice", {
      guildId: input.guildId,
      channelId: input.channelId,
    });
    return { guildId: input.guildId, channelId: input.channelId };
  };

  readonly runStream = async (
    input: RunStreamInput,
    signal: AbortSignal,
  ): Promise<void> => {
    const useHardware = this.config.stream.hardwareAcceleration;
    try {
      await this.streamOnce(input, signal, useHardware, 0);
    } catch (error) {
      if (useHardware && !signal.aborted) {
        // Resume the software retry at wherever playback (incl. any live seek) had reached, rather
        // than restarting the video from 0.
        const resumeAt = this.lastPlaybackPositionSeconds;
        log.warn("hardware (VAAPI) encode failed; retrying with software", {
          error: getErrorMessage(error),
          resumeAt,
        });
        await this.streamOnce(input, signal, false, resumeAt);
        return;
      }
      throw error;
    }
  };

  private async streamOnce(
    input: RunStreamInput,
    signal: AbortSignal,
    useHardware: boolean,
    startSeconds: number,
  ): Promise<void> {
    const { stream } = this.config;
    const prepareOpts = {
      width: stream.width,
      height: stream.height,
      frameRate: stream.fps,
      bitrateVideo: stream.bitrateKbps,
      bitrateVideoMax: stream.bitrateKbps * 2,
      bitrateAudio: stream.bitrateAudioKbps,
      includeAudio: true,
      videoCodec: Utils.normalizeVideoCodec("H264"),
      hardwareAcceleratedDecoding: useHardware,
      minimizeLatency: false,
      ...(startSeconds > 0 ? { startTime: startSeconds } : {}),
      ...(useHardware
        ? { encoder: Encoders.vaapi({ device: stream.vaapiDevice }) }
        : {}),
    };

    log.info("starting stream", {
      title: input.resolved.title,
      hardware: useHardware,
    });

    // The seekable player owns prepare+play on a single Go-Live connection. `finished` resolves at
    // the true end of playback (or on stop) and rejects on an ffmpeg/encode failure — folding in the
    // play/ffmpeg-failure race the old code did by hand, and letting `/stream seek` restart ffmpeg at
    // a new offset without dropping the Go-Live stream.
    const player = createSeekablePlayer(
      this.streamer,
      input.resolved.ffmpegInput,
      {
        prepare: prepareOpts,
        play: { type: "go-live" },
      },
    );
    this.player = player;

    const onAbort = () => {
      player.stop();
    };
    if (signal.aborted) {
      player.stop();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      await player.start();
      try {
        await player.setVolume(Math.max(0, input.volume) / 100);
      } catch (error) {
        log.warn("initial setVolume failed", { error: getErrorMessage(error) });
      }
      await player.finished;
    } finally {
      signal.removeEventListener("abort", onAbort);
      // Capture where playback reached (incl. live seeks) before dropping the player, so a HW→SW
      // retry can resume there.
      this.lastPlaybackPositionSeconds = player.position;
      if (this.player === player) {
        this.player = null;
      }
    }
    log.info("stream ended", { title: input.resolved.title });
  }

  readonly leaveVoice = async (_input: LeaveVoiceInput): Promise<void> => {
    this.safeStop();
    log.info("left voice");
    await Promise.resolve();
  };
}
