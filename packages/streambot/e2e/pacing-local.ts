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
// Run: bun e2e/pacing-local.ts [seconds=60] [regular|discontinuous] [flush]
const seconds = Number(process.argv[2] ?? 60);
assert.ok(Number.isInteger(seconds) && seconds >= 10 && seconds <= 600);
const mode = process.argv[3] ?? "regular";
assert.ok(mode === "regular" || mode === "discontinuous");
const flushPackets = process.argv[4] === "flush";
const directory = await mkdtemp(path.join(tmpdir(), "streambot-pacing-"));
const source = path.join(directory, "1080p.mp4");
const config = loadConfig({
  BOT_TOKEN: "local-probe",
  USER_TOKENS: "local-probe",
  VIDEOS_DIR: directory,
});
const generated = Bun.spawnSync([
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
    ffmpegInputOptions: ["-stream_loop", "-1"],
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
      input: "1920x1080@30 H264/AAC, looped and read at 1x",
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
  await rm(directory, { recursive: true, force: true });
}
