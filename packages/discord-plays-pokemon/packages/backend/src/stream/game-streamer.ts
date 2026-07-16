import { PassThrough } from "node:stream";
import type { Client } from "discord.js-selfbot-v13";
import {
  prepareStream,
  Encoders,
  computeLetterbox,
} from "@shepherdjerred/discord-video-stream";
import type { EncoderHandles } from "@shepherdjerred/discord-stream-lifecycle/types.ts";
import { GameStreamerBase } from "@shepherdjerred/discord-plays-core/stream/game-streamer-base.ts";
import {
  WIDTH,
  HEIGHT,
  GBA_FPS,
  DISPLAY_ASPECT,
} from "#src/emulator/constants.ts";
import { sinkBufferBytes } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import { logger } from "#src/logger.ts";
import { createAudioTransport } from "#src/stream/audio-transport.ts";

export type GameStreamerOptions = {
  /**
   * Pre-built, already-logged-in `discord.js-selfbot-v13` client (typically supplied
   * by the userbot pool). The streamer drives voice/video through this client and
   * does not own its lifecycle — callers manage login/destroy.
   */
  selfbotClient: Client;
  guildId: string;
  channelId: string;
  // Height of the 16:9 output canvas; the 3:2 game is pillarboxed onto it.
  canvasHeight: number;
  frameRate: number;
  bitrateKbps: number;
  bitrateMaxKbps: number;
  // VAAPI hardware H.264 encoding on an Intel iGPU; falls back to libx264 when off.
  hardwareAcceleration: boolean;
  vaapiDevice: string;
};

// rawvideo input framerate handed to ffmpeg — it assigns presentation
// timestamps from this value, so it must match the emulator's actual tick rate
// (GBA_FPS), not a rounded 60, or the output drifts ~0.27 fps behind wall-clock.
const SRC_FPS = GBA_FPS;

// Streams the emulator's RGBA frames into a Discord voice channel as a Go-Live
// broadcast. The lifecycle (join voice → encode → broadcast → leave) is owned by
// the shared GameStreamerBase; this subclass supplies the Pokémon-specific ffmpeg
// wiring (RGBA input, f32le audio) and the simple frame push.
export class GameStreamer extends GameStreamerBase {
  private readonly options: GameStreamerOptions;

  constructor(options: GameStreamerOptions) {
    super({
      selfbotClient: options.selfbotClient,
      guildId: options.guildId,
      channelId: options.channelId,
      logger,
    });
    this.options = options;
  }

  /** Feed one RGBA frame (no-op unless a broadcast is live). */
  pushFrame(frame: Buffer): void {
    if (this.frameSink) {
      this.frameSink.write(frame);
      // Rising buffered bytes ⇒ ffmpeg/encode can't keep up with the frame rate.
      sinkBufferBytes.set(this.frameSink.writableLength);
    }
  }

  protected async buildEncoder(): Promise<EncoderHandles> {
    const rgba = new PassThrough();
    // Scale the 3:2 game into an aspect-correct content box, then pillarbox it onto
    // a black 16:9 canvas for Discord (see prepareStream `pad`).
    const { content, canvas } = computeLetterbox(
      DISPLAY_ASPECT,
      this.options.canvasHeight,
    );
    // Stand up the loopback audio transport before ffmpeg launches so its
    // client connect succeeds immediately. pushAudio writes Float32 LRLR PCM
    // into the transport sink; ffmpeg dials the loopback URL once and muxes
    // the bytes into the broadcast.
    const audioTransport = await createAudioTransport();
    this.audioTransport = audioTransport;
    const { output, promise } = prepareStream(rgba, {
      width: content.width,
      height: content.height,
      pad: canvas,
      frameRate: this.options.frameRate,
      videoCodec: "H264",
      bitrateVideo: this.options.bitrateKbps,
      bitrateVideoMax: this.options.bitrateMaxKbps,
      includeAudio: true,
      // Game audio is the m4a engine's un-quantised Float32 mixer output (see
      // `audio/m4a-driver.ts`); it can't ride the rawvideo stdin so ffmpeg
      // reads it from the loopback socket and muxes it into the broadcast.
      audioInput: {
        source: audioTransport.source,
        inputOptions: audioTransport.inputOptions,
      },
      bitrateAudio: 96,
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
      // Raw-frame input → keep hardwareAcceleratedDecoding off; Encoders.vaapi()
      // then uploads frames to the GPU (format=nv12|vaapi, hwupload) and encodes
      // with h264_vaapi. Software libx264 is the no-GPU fallback (local/arm64).
      encoder: this.options.hardwareAcceleration
        ? Encoders.vaapi({ device: this.options.vaapiDevice })
        : Encoders.software({
            x264: { preset: "ultrafast", tune: "zerolatency" },
          }),
    });
    return { sink: rgba, output, playing: promise };
  }
}
