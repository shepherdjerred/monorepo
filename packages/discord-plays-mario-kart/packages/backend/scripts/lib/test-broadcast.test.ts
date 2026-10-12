import { expect, test, vi } from "vitest";
import { PassThrough } from "node:stream";
import { Encoders } from "@shepherdjerred/discord-video-stream";
import { WIDTH, HEIGHT, GAME_FPS } from "#src/emulator/constants.ts";
import { prepareTestBroadcast } from "./test-broadcast.ts";

const { prepareStream } = vi.hoisted(() => ({ prepareStream: vi.fn() }));
vi.mock("@shepherdjerred/discord-video-stream", () => ({
  prepareStream,
  Encoders: { software: vi.fn(() => "software-encoder") },
}));

test.each([[], ["-probesize", "32"]])(
  "preserves the real harness encoder options with extra inputs %j",
  (...extraInputOptions: string[]) => {
    const video = new PassThrough();
    const transport = {
      source: "tcp://127.0.0.1:23456",
      inputOptions: ["-f", "s16le"],
    };
    const broadcast = { output: new PassThrough(), promise: Promise.resolve() };
    prepareStream.mockReturnValueOnce(broadcast);
    expect(prepareTestBroadcast(video, transport, extraInputOptions)).toBe(
      broadcast,
    );
    expect(prepareStream).toHaveBeenLastCalledWith(video, {
      width: WIDTH,
      height: HEIGHT,
      frameRate: GAME_FPS,
      videoCodec: "H264",
      bitrateVideo: 1000,
      bitrateVideoMax: 1500,
      includeAudio: true,
      audioInput: transport,
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
      encoder: "software-encoder",
    });
    expect(Encoders.software).toHaveBeenLastCalledWith({
      x264: { preset: "ultrafast", tune: "zerolatency" },
    });
    video.destroy();
    broadcast.output.destroy();
  },
);
