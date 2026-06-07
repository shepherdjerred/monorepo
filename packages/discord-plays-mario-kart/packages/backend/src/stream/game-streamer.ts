import { PassThrough, type Readable } from "node:stream";
import { Client } from "discord.js-selfbot-v13";
import {
  Streamer,
  prepareStream,
  playStream,
  Encoders,
} from "@shepherdjerred/discord-video-stream";
import { WIDTH, HEIGHT, N64_FPS } from "#src/emulator/constants.ts";
import { logger } from "#src/logger.ts";

export type GameStreamerOptions = {
  token: string;
  guildId: string;
  channelId: string;
  // Output scale applied to the native 640x240 MK64 frame.
  scale: number;
  frameRate: number;
  bitrateKbps: number;
  bitrateMaxKbps: number;
};

// rawvideo input framerate handed to ffmpeg — it assigns presentation
// timestamps from this value, so it must match the emulator's actual tick rate.
const SRC_FPS = N64_FPS;

// Streams the emulator's RGBA frames into a Discord voice channel as a Go-Live
// broadcast, over the voice UDP path. Replaces the userbot + browser
// screen-share. Frames are fed as rawvideo straight into the library's ffmpeg
// (one encode pass).
export class GameStreamer {
  private readonly options: GameStreamerOptions;
  private readonly streamer: Streamer;
  private rgba: PassThrough | undefined;
  private playing: Promise<void> | undefined;
  private active = false;
  // Serializes start()/stop(). Both are driven fire-and-forget from
  // VoiceStateUpdate callbacks, so without this a stop() landing mid-start()
  // (or a second start()) could interleave at the `await joinVoice` point and
  // orphan the PassThrough/ffmpeg or tear the voice connection. Each call waits
  // for the previous to fully settle before running.
  private opChain: Promise<void> = Promise.resolve();

  constructor(options: GameStreamerOptions) {
    this.options = options;
    this.streamer = new Streamer(new Client());
  }

  async login(): Promise<void> {
    await this.streamer.client.login(this.options.token);
    const user = this.streamer.client.user;
    logger.info(`stream account logged in as ${user?.tag ?? "unknown"}`);
  }

  /** True while a Go-Live broadcast is running and accepting frames. */
  get isStreaming(): boolean {
    return this.active;
  }

  /** Feed one RGBA frame (no-op unless a broadcast is active). */
  pushFrame(frame: Buffer): void {
    if (this.active && this.rgba) this.rgba.write(frame);
  }

  start(): Promise<void> {
    return this.runExclusive(() => this.doStart());
  }

  stop(): Promise<void> {
    return this.runExclusive(() => this.doStop());
  }

  // Runs `op` only after every previously-queued op settles, so start()/stop()
  // never interleave. The synchronous prefix here (capturing `previous` and
  // replacing `this.opChain`) runs before any await, so concurrent callers queue
  // in call order. The barrier never rejects — a failed op can't wedge the
  // queue — yet the returned promise still rejects so callers see the failure.
  private runExclusive(op: () => Promise<void>): Promise<void> {
    const previous = this.opChain;
    const result = (async (): Promise<void> => {
      await previous;
      await op();
    })();
    this.opChain = this.settle(result);
    return result;
  }

  private async settle(work: Promise<void>): Promise<void> {
    try {
      await work;
    } catch {
      // Swallowed so the serialization barrier never wedges on a failed op; the
      // failure is still surfaced to the original caller via runExclusive's
      // returned promise.
    }
  }

  private async doStart(): Promise<void> {
    if (this.active) return;
    await this.streamer.joinVoice(this.options.guildId, this.options.channelId);

    const rgba = new PassThrough();
    const { output, promise } = prepareStream(rgba, {
      width: WIDTH * this.options.scale,
      height: HEIGHT * this.options.scale,
      frameRate: this.options.frameRate,
      videoCodec: "H264",
      bitrateVideo: this.options.bitrateKbps,
      bitrateVideoMax: this.options.bitrateMaxKbps,
      includeAudio: false,
      minimizeLatency: true,
      customInputOptions: [
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-video_size",
        `${String(WIDTH)}x${String(HEIGHT)}`,
        "-framerate",
        String(SRC_FPS),
      ],
      encoder: Encoders.software({
        x264: { preset: "ultrafast", tune: "zerolatency" },
      }),
    });

    // Publish state only once the stream is fully wired; these assignments are
    // synchronous (no await between them), so pushFrame never sees a half-set
    // state.
    this.rgba = rgba;
    this.playing = this.runStream(output, promise);
    this.active = true;
    logger.info("Go-Live stream started");
  }

  // Drives the Go-Live broadcast and watches the ffmpeg encode for errors.
  // ffmpeg is killed when the frame stream ends on stop(), which is expected
  // and not surfaced as an error.
  private async runStream(
    output: Readable,
    encode: Promise<void>,
  ): Promise<void> {
    try {
      await Promise.all([
        playStream(output, this.streamer, { type: "go-live" }),
        encode,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/SIGKILL|signal 9|Exiting normally/i.test(message)) {
        logger.error(`stream error: ${message}`);
      }
    }
  }

  private async doStop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.rgba?.end();
    this.rgba = undefined;
    // runStream never rejects (it logs internally), so awaiting is safe.
    await this.playing;
    this.playing = undefined;
    this.streamer.leaveVoice();
    logger.info("Go-Live stream stopped");
  }

  destroy(): void {
    this.streamer.client.destroy();
  }
}
