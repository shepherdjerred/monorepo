import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { Decoder, Demuxer, FilterAPI } from "node-av";

let fixtureDirectory = "";
let fixturePath = "";

beforeAll(async () => {
  if (ffmpegPath === null) {
    throw new Error(
      `ffmpeg-static does not provide a binary for ${process.platform}/${process.arch}`,
    );
  }

  fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "discord-video-stream-node-av-"),
  );
  fixturePath = path.join(fixtureDirectory, "testsrc.nut");

  const ffmpeg = Bun.spawnSync([
    ffmpegPath,
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=16x12:rate=3:duration=1",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-f",
    "nut",
    "-y",
    fixturePath,
  ]);

  if (ffmpeg.exitCode !== 0) {
    throw new Error(
      `Failed to create the node-av fixture: ${ffmpeg.stderr.toString()}`,
    );
  }
});

afterAll(async () => {
  await rm(fixtureDirectory, { force: true, recursive: true });
});

describe("node-av native FFmpeg binding", () => {
  test("demuxes, decodes, filters, and releases a real video", async () => {
    const demuxer = await Demuxer.open(fixturePath);
    const video = demuxer.video();
    if (!video) {
      await demuxer.close();
      throw new Error("Generated fixture did not contain a video stream");
    }

    expect(video.codecpar.width).toBe(16);
    expect(video.codecpar.height).toBe(12);

    const decoder = await Decoder.create(video);
    const filter = FilterAPI.create("scale=8:6,format=pix_fmts=rgba");
    let packetCount = 0;
    let decodedFrameCount = 0;
    let filteredFrameCount = 0;

    try {
      for await (const packet of demuxer.packets(video.index)) {
        if (packet === null) continue;
        packetCount += 1;
        const frames = await decoder.decodeAll(packet);
        packet.free();

        for (const frame of frames) {
          decodedFrameCount += 1;
          const filteredFrames = await filter.processAll(frame);
          frame.free();

          for (const filteredFrame of filteredFrames) {
            expect(filteredFrame.width).toBe(8);
            expect(filteredFrame.height).toBe(6);
            expect(filteredFrame.data?.[0]?.byteLength).toBeGreaterThan(0);
            filteredFrameCount += 1;
            filteredFrame.free();
          }
        }
      }

      const delayedFrames = await decoder.decodeAll(null);
      for (const frame of delayedFrames) {
        decodedFrameCount += 1;
        const filteredFrames = await filter.processAll(frame);
        frame.free();

        for (const filteredFrame of filteredFrames) {
          expect(filteredFrame.width).toBe(8);
          expect(filteredFrame.height).toBe(6);
          filteredFrameCount += 1;
          filteredFrame.free();
        }
      }
    } finally {
      filter.close();
      decoder.close();
      await demuxer.close();
    }

    expect(packetCount).toBeGreaterThanOrEqual(1);
    expect(decodedFrameCount).toBe(3);
    expect(filteredFrameCount).toBe(3);
  });

  test("rejects a missing native input instead of returning an empty demuxer", async () => {
    const missingPath = path.join(fixtureDirectory, "missing.nut");
    await expect(Demuxer.open(missingPath)).rejects.toThrow();
  });
});
