import { describe, expect, test } from "vitest";
import { Readable } from "node:stream";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { demux } from "../src/media/LibavDemuxer.ts";

function ffmpeg(args: string[], stdin?: Uint8Array): Buffer {
  if (ffmpegPath === null)
    throw new Error("Missing required ffmpeg-static binary");
  const result = Bun.spawnSync(
    [ffmpegPath, "-hide_banner", "-loglevel", "error", ...args],
    {
      ...(stdin === undefined ? {} : { stdin }),
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}

function fixture(codec: "h264" | "hevc", container: "mp4" | "nut"): Buffer {
  const encoded = ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x96:rate=30:duration=8",
    "-c:v",
    codec === "h264" ? "libx264" : "libx265",
    "-preset",
    "ultrafast",
    "-threads",
    "1",
    ...(codec === "hevc"
      ? ["-x265-params", "pools=none:frame-threads=1:log-level=error"]
      : []),
    ...(container === "mp4"
      ? ["-flags", "+global_header", "-movflags", "frag_keyframe+empty_moov"]
      : []),
    "-f",
    container,
    "pipe:1",
  ]);
  return container === "nut"
    ? encoded
    : ffmpeg(["-i", "pipe:0", "-c:v", "copy", "-f", "nut", "pipe:1"], encoded);
}

describe("native video demux filter chain", () => {
  test.each([
    ["h264", "mp4"],
    ["h264", "nut"],
    ["hevc", "mp4"],
  ] as const)(
    "delivers %s packets from %s framing with valid metadata",
    async (codec, container) => {
      const { video } = await demux(
        Readable.from([fixture(codec, container)]),
        { format: "nut" },
      );
      if (!video) throw new Error("Missing generated video");
      expect([video.width, video.height]).toEqual([160, 96]);
      expect(video.framerate_num / video.framerate_den).toBe(30);
      let packets = 0;
      for await (const packet of video.stream) {
        try {
          // Both framing variants must emerge as Annex B, including codec headers.
          const prefix = packet.data?.subarray(0, 4).toString("hex");
          expect(prefix?.startsWith("000001") || prefix === "00000001").toBe(
            true,
          );
          packets++;
        } finally {
          packet.free();
        }
      }
      expect(packets).toBeGreaterThan(100);
    },
  );

  test("repeated extraction failures release native resources without crashing", async () => {
    const media = fixture("h264", "mp4");
    const source = path.resolve("src/media/LibavDemuxer.ts");
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
      import { Readable } from "node:stream";
      import { demux } from ${JSON.stringify(source)};
      const bytes = await Bun.stdin.bytes();
      for (let i = 0; i < 10; i++) {
        const { video } = await demux(Readable.from([bytes]), {
          format: "nut",
          observer: { onPacketReady() { throw new Error("injected extraction failure"); } },
        });
        if (!video) throw new Error("Missing video");
        try {
          for await (const packet of video.stream) packet.free();
          throw new Error("Expected extraction failure");
        } catch (error) {
          if (error.message !== "injected extraction failure") throw error;
        }
      }
    `,
      ],
      { stdin: media, stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
  });
});
