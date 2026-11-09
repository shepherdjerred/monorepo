import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createSeekablePlayer,
  Streamer,
  VoiceConnection,
} from "@shepherdjerred/discord-video-stream";
import { Client } from "discord.js-selfbot-v13";
import type {
  SendStats,
  PacketReadyStats,
} from "@shepherdjerred/discord-video-stream";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { buildVideoPrepareOptions } from "@shepherdjerred/streambot/streamer/prepare-options.ts";

// A credential-free measurement of the real ffmpeg → native demux → paced sender.
// Run: bun e2e/pacing-local.ts [seconds=60] [regular|discontinuous|live|live-ungated] [flush]
//
// `live` serves a local live HLS playlist shaped like Twitch's (2 s segments, published at
// realtime, a sliding window) whose upstream stalls once for LIVE_STALL_MS partway through — the
// shape that leaves a live pacer behind its schedule. `live` plays it with the production rebuffer
// cushion (`stream.liveBufferMs`); `live-ungated` is the same input without it, for comparison.
const seconds = Number(process.argv[2] ?? 60);
assert.ok(Number.isInteger(seconds) && seconds >= 10 && seconds <= 600);
const mode = process.argv[3] ?? "regular";
assert.ok(
  mode === "regular" ||
    mode === "discontinuous" ||
    mode === "live" ||
    mode === "live-ungated",
);
const liveInput = mode === "live" || mode === "live-ungated";
const flushPackets = process.argv[4] === "flush";
const directory = await mkdtemp(path.join(tmpdir(), "streambot-pacing-"));
const config = loadConfig({
  BOT_TOKEN: "local-probe",
  USER_TOKENS: "local-probe",
  VIDEOS_DIR: directory,
});
const SEGMENT_SECONDS = 2;
/** Segments already published when playback starts, like joining a broadcast in progress. */
const LIVE_PUBLISHED_AT_START = 4;
/** Segments the live playlist lists at once. */
const LIVE_WINDOW = 8;
/** The one upstream stall: from this segment on, everything is published this much later. */
const LIVE_STALL_SEGMENT = 8;
const LIVE_STALL_MS = 5000;
let liveServer: ReturnType<typeof Bun.serve> | undefined;
const source = liveInput
  ? servedLivePlaylist()
  : path.join(directory, "1080p.mp4");

function servedLivePlaylist(): string {
  const segments = seconds / SEGMENT_SECONDS + LIVE_PUBLISHED_AT_START + 8;
  const hls = Bun.spawnSync([
    config.ffmpegPath,
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=1920x1080:rate=30:duration=${String(segments * SEGMENT_SECONDS)}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=48000:duration=${String(segments * SEGMENT_SECONDS)}`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "2",
    "-bf",
    "0",
    "-g",
    "60",
    "-keyint_min",
    "60",
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    "4000k",
    "-c:a",
    "aac",
    "-f",
    "hls",
    "-hls_time",
    String(SEGMENT_SECONDS),
    "-hls_list_size",
    "0",
    "-hls_segment_filename",
    path.join(directory, "seg%04d.ts"),
    path.join(directory, "vod.m3u8"),
  ]);
  assert.equal(hls.exitCode, 0, hls.stderr.toString());
  const startedAt = performance.now();
  const publishedAt = (index: number) =>
    startedAt +
    (index - LIVE_PUBLISHED_AT_START + 1) * SEGMENT_SECONDS * 1000 +
    (index >= LIVE_STALL_SEGMENT ? LIVE_STALL_MS : 0);
  liveServer = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/live.m3u8") {
        let published = 0;
        while (
          published < segments &&
          publishedAt(published) <= performance.now()
        ) {
          published++;
        }
        const first = Math.max(0, published - LIVE_WINDOW);
        const lines = [
          "#EXTM3U",
          "#EXT-X-VERSION:3",
          `#EXT-X-TARGETDURATION:${String(SEGMENT_SECONDS)}`,
          `#EXT-X-MEDIA-SEQUENCE:${String(first)}`,
        ];
        for (let index = first; index < published; index++) {
          lines.push(
            `#EXTINF:${SEGMENT_SECONDS.toFixed(3)},`,
            `seg${String(index).padStart(4, "0")}.ts`,
          );
        }
        return new Response(`${lines.join("\n")}\n`, {
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
      }
      const segment = /^\/(seg\d{4}\.ts)$/.exec(pathname)?.[1];
      return segment === undefined
        ? new Response("not found", { status: 404 })
        : new Response(Bun.file(path.join(directory, segment)));
    },
  });
  return `http://127.0.0.1:${String(liveServer.port)}/live.m3u8`;
}

const generated = liveInput
  ? { exitCode: 0, stderr: Buffer.from("") }
  : Bun.spawnSync([
      config.ffmpegPath,
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1920x1080:rate=30:duration=8",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=8",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "2",
      "-bf",
      "0",
      "-g",
      "30",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      "4000k",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      source,
    ]);
assert.equal(generated.exitCode, 0, generated.stderr.toString());

type Sample = {
  time: number;
  readyAt: number;
  pts: number;
  behind: number;
  syncWait: number;
  liveEvent: SendStats["liveEvent"];
};
const sends: Record<"video" | "audio", number[]> = { video: [], audio: [] };
const ready: Record<"video" | "audio", number[]> = { video: [], audio: [] };
const samples: Record<"video" | "audio", Sample[]> = { video: [], audio: [] };
const observer = {
  onCommand(command: string) {
    if (flushPackets) assert.ok(command.includes("-flush_packets"));
  },
  onPacketReady(stats: PacketReadyStats) {
    ready[stats.kind].push(performance.now());
  },
  onSendStats(stats: SendStats) {
    const time = sends[stats.kind][samples[stats.kind].length];
    const readyAt = ready[stats.kind][samples[stats.kind].length];
    assert.ok(
      time !== undefined,
      "send stats must correspond to a delivered frame",
    );
    assert.ok(readyAt !== undefined);
    samples[stats.kind].push({
      time,
      readyAt,
      pts: stats.ptsMs,
      behind: stats.behindMs,
      syncWait: stats.syncWaitMs,
      liveEvent: stats.liveEvent,
    });
  },
};
// Construct the production types without logging in; replace the network boundary
// with a timestamp recorder while retaining the real player, demux, and pacers.
const client = new Client();
const streamer = new Streamer(client);
function noNetwork() {
  // This probe records delivery locally and never opens a Discord connection.
}
const connection = new VoiceConnection(
  streamer,
  "local",
  "local",
  "local",
  noNetwork,
);
const conn = connection.webRtcConn;
conn.setPacketizer = noNetwork;
conn.sendVideoFrame = () => {
  sends.video.push(performance.now());
};
conn.sendAudioFrame = () => {
  sends.audio.push(performance.now());
  return true;
};
connection.setSpeaking = noNetwork;
connection.setVideoAttributes = noNetwork;
streamer.createStream = () => Promise.resolve(conn);
streamer.stopStream = noNetwork;
const prepare = buildVideoPrepareOptions({
  stream: config.stream,
  resolved: {
    title: "local pacing probe",
    ffmpegInput: source,
    mediaKind: "video",
    chapters: [],
    ...(liveInput
      ? { live: true as const }
      : { ffmpegInputOptions: ["-stream_loop", "-1"] }),
    ...(mode === "discontinuous" ? { discontinuousLive: true } : {}),
  },
  startSeconds: 0,
  volumePercent: 100,
  pipelineMode: "sw",
});
const player = createSeekablePlayer(streamer, source, {
  prepare: {
    ...prepare,
    observer,
    lowLatencyMux: flushPackets,
    customFfmpegFlags: ["-t", String(seconds)],
  },
  play: {
    type: "go-live",
    observer,
    streamPreview: false,
    readrateInitialBurst: config.stream.readrateInitialBurst,
    videoPlayoutDelayMaxMs: config.stream.videoPlayoutDelayMaxMs,
    ...(mode === "live" ? { liveBufferMs: config.stream.liveBufferMs } : {}),
  },
});
async function observeFailure() {
  try {
    await player.finished;
  } catch {
    // The main path below awaits and reports the failure after start settles.
  }
}
void observeFailure();
let timeout: ReturnType<typeof setTimeout> | undefined;
const timedOut = new Promise<never>((_resolve, reject) => {
  timeout = setTimeout(
    () => {
      reject(new Error("Pacing probe timed out"));
    },
    (seconds + 45) * 1000,
  );
});

function percentile(values: number[], fraction: number): number {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((a, b) => a - b);
  const value =
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  assert.ok(value !== undefined);
  return Number(value.toFixed(2));
}
function summarize(kind: "video" | "audio") {
  // The configured initial burst deliberately sends ahead to fill the receiver buffer.
  const paced = samples[kind].filter(
    (sample) => sample.pts > config.stream.readrateInitialBurst * 1000,
  );
  const first = paced[0];
  const last = paced.at(-1);
  assert.ok(
    first && last && paced.length > seconds * (kind === "video" ? 20 : 35),
  );
  const gaps = paced.slice(1).map((sample, index) => {
    const previous = paced[index];
    assert.ok(previous);
    return sample.time - previous.time;
  });
  const drift = paced.map(
    (sample) => sample.time - first.time - (sample.pts - first.pts),
  );
  const endingDrift = drift.at(-1);
  assert.ok(endingDrift !== undefined);
  const maxGapIndex = gaps.indexOf(Math.max(...gaps));
  const beforeGap = paced[maxGapIndex];
  const afterGap = paced[maxGapIndex + 1];
  assert.ok(beforeGap && afterGap);
  return {
    frames: samples[kind].length,
    pacedFrames: paced.length,
    mediaSeconds: Number(((last.pts - first.pts) / 1000).toFixed(3)),
    wallSeconds: Number(((last.time - first.time) / 1000).toFixed(3)),
    mediaPerWallSecond: Number(
      ((last.pts - first.pts) / (last.time - first.time)).toFixed(5),
    ),
    gapMs: {
      p50: percentile(gaps, 0.5),
      p99: percentile(gaps, 0.99),
      max: percentile(gaps, 1),
    },
    gapsOver100ms: gaps.filter((gap) => gap > 100).length,
    gapsOver200ms: gaps.filter((gap) => gap > 200).length,
    producerGapAtLargestSendGapMs: Number(
      (afterGap.readyAt - beforeGap.readyAt).toFixed(2),
    ),
    endingDriftMs: Number(endingDrift.toFixed(2)),
    maxDriftMs: percentile(drift, 1),
    framesOver200msBehind: paced.filter((sample) => sample.behind > 200).length,
    maxReportedBehindMs: percentile(
      paced.map((sample) => sample.behind),
      1,
    ),
    syncWaitMs: Number(
      paced.reduce((sum, sample) => sum + sample.syncWait, 0).toFixed(2),
    ),
    liveRebuffers: paced.filter((sample) => sample.liveEvent === "rebuffer")
      .length,
    liveReanchors: paced.filter((sample) => sample.liveEvent === "reanchor")
      .length,
    // Once the upstream stall has passed, a healthy live pacer is smooth again; an ungated one
    // keeps forwarding each segment as a burst.
    gapsOver200msAfterStall: gaps.filter(
      (gap, index) =>
        gap > 200 &&
        (paced[index]?.pts ?? first.pts) - first.pts >
          // ffmpeg joins a live playlist three segments from its end, so the first frame played
          // is segment LIVE_PUBLISHED_AT_START - 3; count from two segments after the stall.
          (LIVE_STALL_SEGMENT + 2 - (LIVE_PUBLISHED_AT_START - 3)) *
            SEGMENT_SECONDS *
            1000,
    ).length,
  };
}
try {
  await Promise.race([
    (async () => {
      await player.start();
      await player.finished;
    })(),
    timedOut,
  ]);
  const video = summarize("video");
  const audio = summarize("audio");
  let audioIndex = 0;
  const skew: number[] = [];
  for (const frame of samples.video) {
    for (;;) {
      const next = samples.audio[audioIndex + 1];
      if (!next || next.time > frame.time) break;
      audioIndex++;
    }
    const audioFrame = samples.audio[audioIndex];
    if (audioFrame && frame.pts > config.stream.readrateInitialBurst * 1000)
      skew.push(Math.abs(frame.pts - audioFrame.pts));
  }
  console.log(
    `PACING_RESULT ${JSON.stringify({
      runtime: Bun.version,
      platform: process.platform,
      arch: process.arch,
      seconds,
      mode,
      flushPackets,
      input: liveInput
        ? `local live HLS, ${String(SEGMENT_SECONDS)} s segments, one ${String(LIVE_STALL_MS)} ms upstream stall`
        : "1920x1080@30 H264/AAC, looped and read at 1x",
      liveBufferMs: mode === "live" ? config.stream.liveBufferMs : null,
      output: `${String(config.stream.width)}x${String(config.stream.height)}@${String(config.stream.fps)} H264/Opus`,
      encoding: "software",
      initialBurstSeconds: config.stream.readrateInitialBurst,
      video,
      audio,
      avSkewMs: { p99: percentile(skew, 0.99), max: percentile(skew, 1) },
    })}`,
  );
} finally {
  if (timeout !== undefined) clearTimeout(timeout);
  player.stop();
  connection.stop();
  streamer.dispose();
  client.destroy();
  await liveServer?.stop(true);
  await rm(directory, { recursive: true, force: true });
}
