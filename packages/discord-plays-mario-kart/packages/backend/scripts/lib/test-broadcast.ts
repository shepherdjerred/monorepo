import type { PassThrough } from "node:stream";
import { prepareStream, Encoders } from "@shepherdjerred/discord-video-stream";
import type { AudioTransport } from "@shepherdjerred/discord-plays-core/stream/audio-transport.ts";
import { WIDTH, HEIGHT, GAME_FPS } from "#src/emulator/constants.ts";

/** The real software encoder shared by the audio and latency harnesses. */
export function prepareTestBroadcast(
  video: PassThrough,
  transport: Pick<AudioTransport, "source" | "inputOptions">,
  extraInputOptions: string[] = [],
) {
  return prepareStream(video, {
    width: WIDTH,
    height: HEIGHT,
    frameRate: GAME_FPS,
    videoCodec: "H264",
    bitrateVideo: 1000,
    bitrateVideoMax: 1500,
    includeAudio: true,
    audioInput: {
      source: transport.source,
      inputOptions: transport.inputOptions,
    },
    minimizeLatency: true,
    customInputOptions: [
      "-f",
      "rawvideo",
      "-pix_fmt",
      "bgra",
      "-video_size",
      `${String(WIDTH)}x${String(HEIGHT)}`,
      "-framerate",
      String(GAME_FPS),
      ...extraInputOptions,
    ],
    encoder: Encoders.software({
      x264: { preset: "ultrafast", tune: "zerolatency" },
    }),
  });
}
