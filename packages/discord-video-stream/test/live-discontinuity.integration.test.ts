import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { prepareStream } from "../src/media/newApi.ts";
import { demux } from "../src/media/LibavDemuxer.ts";

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
  for (const [name, frequency] of [["ad", 440], ["live", 880]] as const) {
    const result = ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=30:duration=2",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:duration=2`,
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
    ffmpegPath,
  });
  const chunks: Buffer[] = [];
  const collecting = (async () => {
    for await (const chunk of prepared.output) chunks.push(Buffer.from(chunk));
  })();
  await Promise.all([prepared.promise, collecting]);
  expect(chunks.length).toBeGreaterThan(0);

  const { video, audio } = await demux(Readable.from(chunks), {
    format: "nut",
  });
  expect(video).toBeDefined();
  expect(audio).toBeDefined();
  await Promise.all(
    [video?.stream, audio?.stream].map(async (stream) => {
      if (stream === undefined) throw new Error("missing normalized stream");
      const timestamps: bigint[] = [];
      for await (const packet of stream) {
        timestamps.push(BigInt(packet.pts));
        packet.free();
      }
      expect(timestamps.length).toBeGreaterThan(30);
      expect(
        timestamps.slice(1).every((pts, index) => pts > timestamps[index]!),
      ).toBe(true);
    }),
  );
});
