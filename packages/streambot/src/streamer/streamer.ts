import { Client } from "discord.js-selfbot-v13";
import {
  Encoders,
  Streamer,
  Utils,
  prepareStream,
  playStream,
} from "@dank074/discord-video-stream";
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

type StreamController = { setVolume: (volume: number) => Promise<boolean> };

/**
 * Owns the selfbot voice connection and ffmpeg streaming via `@dank074/discord-video-stream`.
 * Its methods are the playback machine's `joinVoice` / `runStream` / `leaveVoice` actors, so all
 * voice I/O is driven by — and cancellable from — the machine. Uses Intel VAAPI hardware encoding
 * when enabled, falling back to software if the device/driver is unavailable.
 */
export class StreambotStreamer {
  private readonly client: Client;
  private readonly streamer: Streamer;
  private readonly config: Config;
  private controller: StreamController | null = null;

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
    this.client.destroy();
    await Promise.resolve();
  }

  /** Apply a volume percentage (0-200) to the live stream; false when nothing is playing. */
  async setVolume(percent: number): Promise<boolean> {
    if (this.controller === null) {
      return false;
    }
    await this.controller.setVolume(Math.max(0, percent) / 100);
    return true;
  }

  private safeStop(): void {
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
      await this.streamOnce(input, signal, useHardware);
    } catch (error) {
      if (useHardware && !signal.aborted) {
        log.warn("hardware (VAAPI) encode failed; retrying with software", {
          error: getErrorMessage(error),
        });
        await this.streamOnce(input, signal, false);
        return;
      }
      throw error;
    }
  };

  private async streamOnce(
    input: RunStreamInput,
    signal: AbortSignal,
    useHardware: boolean,
  ): Promise<void> {
    const { stream } = this.config;
    const streamOpts = {
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
      ...(useHardware
        ? { encoder: Encoders.vaapi({ device: stream.vaapiDevice }) }
        : {}),
    };

    log.info("starting stream", {
      title: input.resolved.title,
      hardware: useHardware,
    });
    const { output, promise, controller } = prepareStream(
      input.resolved.ffmpegInput,
      streamOpts,
      signal,
    );
    this.controller = controller;
    try {
      await controller.setVolume(Math.max(0, input.volume) / 100);
    } catch (error) {
      log.warn("initial setVolume failed", { error: getErrorMessage(error) });
    }
    try {
      // playStream resolves on natural end; `promise` rejects on ffmpeg failure. Race them.
      await Promise.race([
        playStream(output, this.streamer, undefined, signal),
        promise,
      ]);
    } finally {
      this.controller = null;
    }
    log.info("stream ended", { title: input.resolved.title });
  }

  readonly leaveVoice = async (_input: LeaveVoiceInput): Promise<void> => {
    this.safeStop();
    log.info("left voice");
    await Promise.resolve();
  };
}
