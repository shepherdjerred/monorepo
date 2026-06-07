import { Client } from "discord.js-selfbot-v13";
import {
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

/**
 * Owns the selfbot voice connection and ffmpeg streaming via `@dank074/discord-video-stream`.
 * Its methods are wired in as the playback machine's `joinVoice` / `runStream` / `leaveVoice`
 * actors, so all voice I/O is driven by — and cancellable from — the machine.
 */
export class StreambotStreamer {
  private readonly client: Client;
  private readonly streamer: Streamer;
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
    this.client = new Client();
    this.streamer = new Streamer(this.client);
  }

  async login(): Promise<void> {
    await this.client.login(this.config.discord.userToken);
    log.info("streamer logged in", { user: this.client.user?.username });
  }

  async destroy(): Promise<void> {
    this.safeStop();
    this.client.destroy();
    await Promise.resolve();
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
    const { stream } = this.config;
    const streamOpts = {
      width: stream.width,
      height: stream.height,
      frameRate: stream.fps,
      bitrateVideo: stream.bitrateKbps,
      bitrateVideoMax: stream.bitrateKbps * 2,
      videoCodec: Utils.normalizeVideoCodec("H264"),
      hardwareAcceleratedDecoding: stream.hardwareAcceleration,
      minimizeLatency: false,
      h26xPreset: "ultrafast" as const,
    };

    log.info("starting stream", { title: input.resolved.title });
    // `prepareStream` returns `output` (the muxed stream) and `promise` (the ffmpeg lifecycle,
    // which rejects on encoder failure). playStream resolves when the stream ends. Race them — the
    // first to settle wins. On SKIP/STOP the machine aborts `signal` and discards this actor, so a
    // late settle is harmless. (We deliberately avoid the `command` handle to stay clear of the
    // untyped fluent-ffmpeg surface.)
    const { output, promise } = prepareStream(
      input.resolved.ffmpegInput,
      streamOpts,
      signal,
    );
    await Promise.race([
      playStream(output, this.streamer, undefined, signal),
      promise,
    ]);
    log.info("stream ended", { title: input.resolved.title });
  };

  readonly leaveVoice = async (_input: LeaveVoiceInput): Promise<void> => {
    this.safeStop();
    log.info("left voice");
    await Promise.resolve();
  };
}
