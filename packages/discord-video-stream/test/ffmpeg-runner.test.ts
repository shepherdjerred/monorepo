import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  FfmpegExitError,
  prepareStream,
} from "../src/media/newApi.ts";
import type {
  FfmpegCodecData,
  FfmpegProgress,
} from "../src/media/StreamObserver.ts";

const fakeFfmpegPath = fileURLToPath(
  new URL("./fixtures/fake-ffmpeg.ts", import.meta.url),
);

describe("direct ffmpeg runner", () => {
  test("streams stdout and reports command, codec metadata, and progress", async () => {
    let command = "";
    let codecData: FfmpegCodecData | undefined;
    let progress: FfmpegProgress | undefined;
    let outputBytes = 0;

    const prepared = prepareStream("testsrc=size=16x16:rate=2:duration=1", {
      customInputOptions: ["-f", "lavfi"],
      includeAudio: false,
      width: 16,
      height: 16,
      ffmpegPath: fakeFfmpegPath,
      observer: {
        onCommand(value) {
          command = value;
        },
        onCodecData(value) {
          codecData = value;
        },
        onProgress(value) {
          progress = value;
        },
      },
    });
    prepared.output.on("data", (chunk: Uint8Array) => {
      outputBytes += chunk.byteLength;
    });

    await prepared.promise;

    expect(command).toContain("-progress pipe:2");
    expect(command).toContain("testsrc=size=16x16:rate=2:duration=1");
    expect(codecData?.video).toBe("wrapped_avframe");
    expect(progress?.frames).toBeGreaterThanOrEqual(1);
    expect(outputBytes).toBeGreaterThan(0);
  });

  test("rejects with the exit code and stderr tail", async () => {
    const prepared = prepareStream(
      "/definitely/not/a/real/discord-video-stream-input",
      {
        includeAudio: false,
        noTranscoding: true,
        ffmpegPath: fakeFfmpegPath,
      },
    );
    prepared.output.resume();

    try {
      await prepared.promise;
      throw new Error("ffmpeg unexpectedly accepted a missing input");
    } catch (error) {
      if (!(error instanceof FfmpegExitError)) throw error;
      expect(error.exitCode).not.toBeNull();
      expect(error.stderrTail.join("\n")).toContain("No such file or directory");
    }
  });
});
