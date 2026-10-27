import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Demuxer } from "node-av";
import { prepareStream } from "../src/media/newApi.ts";
import { PacketTimestampNormalizer } from "../src/media/LibavDemuxer.ts";

// Exercise the system FFmpeg used by hosted consumers. The Linux static build
// crashes while opening MPEG-TS HLS, before timestamp normalization runs.
const ffmpegPath = Bun.which("ffmpeg");
if (ffmpegPath === null) {
  throw new Error("The HLS integration test requires system ffmpeg on PATH");
}

let directory = "";
let playlist = "";

function ffmpeg(args: string[]): Bun.SpawnSyncResult {
  return Bun.spawnSync([
    ffmpegPath,
    "-hide_banner",
    "-loglevel",
    "info",
    "-y",
    ...args,
  ]);
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "live-discontinuity-"));
  playlist = path.join(directory, "live.m3u8");
  for (const [name, frequency, size, sampleRate] of [
    ["ad", 440, "320x180", 44_100],
    ["live", 880, "640x360", 44_100],
  ] as const) {
    const result = ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${size}:rate=30:duration=2`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:sample_rate=${sampleRate}:duration=2`,
      "-c:v",
      "libx264",
      "-g",
      "30",
      "-keyint_min",
      "30",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-f",
      "mpegts",
      path.join(directory, `${name}.ts`),
    ]);
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  }
  await writeFile(
    playlist,
    "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2.0,\nad.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:2.0,\nlive.ts\n#EXT-X-ENDLIST\n",
  );
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("normalizes timestamps across an HLS discontinuity", async () => {
  const control = ffmpeg([
    "-i",
    playlist,
    "-map",
    "0:v",
    "-vf",
    "scale=320:180",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-bf",
    "0",
    "-map",
    "0:a",
    "-af",
    "volume=1.0",
    "-ar",
    "48000",
    "-c:a",
    "libopus",
    "-f",
    "nut",
    path.join(directory, "control.nut"),
  ]);
  expect(control.signalCode, control.stderr.toString()).toBeUndefined();
  expect(
    control.exitCode !== 0 ||
      /Non-monotonous|backward in time|Multiple keyframes/u.test(
        control.stderr.toString(),
      ),
  ).toBe(true);

  const prepared = prepareStream(playlist, {
    width: 320,
    height: 180,
    frameRate: 30,
    normalizeTimestamps: true,
    customInputOptions: ["-re"],
    ffmpegPath,
  });
  const chunks: Buffer[] = [];
  const collecting = (async () => {
    for await (const chunk of prepared.output) chunks.push(Buffer.from(chunk));
  })();
  await Promise.all([prepared.promise, collecting]);
  expect(chunks.length).toBeGreaterThan(0);

  await writeFile(
    path.join(directory, "normalized.mkv"),
    Buffer.concat(chunks),
  );
  const demuxer = await Demuxer.open(path.join(directory, "normalized.mkv"));
  const video = demuxer.video();
  const audio = demuxer.audio();
  if (!video || !audio) throw new Error("missing normalized stream");
  const normalizer = new PacketTimestampNormalizer({ num: 1, den: 30 });
  try {
    const [videoTimestamps, audioTimestamps] = await Promise.all(
      [video, audio].map(async (stream) => {
        const timestamps: bigint[] = [];
        for await (const packet of demuxer.packets(stream.index)) {
          if (packet === null) continue;
          if (stream.index === video.index) normalizer.video(packet);
          else normalizer.audio(packet);
          timestamps.push(BigInt(packet.pts ?? 0));
          packet.free();
        }
        return timestamps;
      }),
    );
    expect(videoTimestamps).toHaveLength(121);
    expect(audioTimestamps.length).toBeGreaterThan(180);
    for (const timestamps of [videoTimestamps, audioTimestamps]) {
      expect(
        timestamps.slice(1).every((pts, index) => pts > timestamps[index]!),
      ).toBe(true);
    }
  } finally {
    await demuxer.close();
  }
});
