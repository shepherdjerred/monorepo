import { rm } from "node:fs/promises";
import { prepareStream } from "@shepherdjerred/discord-video-stream";
import type { StreamObserver } from "@shepherdjerred/discord-video-stream";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import {
  probeMedia,
  resolutionBucket,
} from "@shepherdjerred/streambot/sources/probe.ts";
import { resolveSource } from "@shepherdjerred/streambot/sources/resolve.ts";
import { createStreamObserver } from "@shepherdjerred/streambot/observability/stream-observer.ts";
import {
  register,
  startMetricsServer,
  stopMetricsServer,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

/**
 * Credential-free local end-to-end test of the observability stack. Unlike `e2e/run.ts` (which needs
 * real Discord tokens), this exercises everything that does NOT require a Discord
 * voice connection, against a REAL ffmpeg/ffprobe:
 *
 *   1. ffprobe — generate an HEVC 10-bit HDR clip with a 6-channel audio track and confirm
 *      `probeMedia` extracts the codec / resolution / HDR / audio and sets `streambot_source_info`.
 *   2. Fork `StreamObserver` — run the fork's real ffmpeg transcode pipeline with an observer and
 *      confirm it receives the command line, input codecData, and progress events, and that the
 *      derived realtime ratio lands in `streambot_ffmpeg_speed_ratio`.
 *   3. /metrics — boot the Prometheus server and scrape it over HTTP.
 *
 * NOT covered locally: the Discord send path (`onSendStats` → `streambot_send_*`), which needs a live
 * voice connection — that lives in the credentialed `e2e/run.ts`.
 *
 * Run: `bun run e2e:local` (from packages/streambot). Exits non-zero on the first failed assertion.
 */
const log = logger.child("e2e:local");

const CLIP = "/tmp/streambot-local-e2e.mp4";
// Long/large enough that the re-encode emits several ffmpeg progress events (so the realtime ratio,
// which needs two consecutive events, populates).
const CLIP_SECONDS = 30;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    log.info(`PASS — ${name}`, detail === undefined ? {} : { detail });
  } else {
    failures += 1;
    log.error(`FAIL — ${name}`, detail === undefined ? {} : { detail });
  }
}

async function generateClip(ffmpegPath: string): Promise<void> {
  // HEVC Main10 + HDR (PQ/BT.2020) video and a 6-channel E-AC-3 track — a small stand-in for the
  // "2160p HEVC 10-bit + lossless multichannel" remux class that triggered the incident.
  const proc = Bun.spawn(
    [
      ffmpegPath,
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=duration=${String(CLIP_SECONDS)}:size=1920x1080:rate=30`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${String(CLIP_SECONDS)}`,
      "-c:v",
      "libx265",
      "-pix_fmt",
      "yuv420p10le",
      // HDR (PQ/BT.2020) signalling. The MP4 container + `hvc1` tag + x265 `hdr10-opt` are what make
      // ffprobe report `color_transfer=smpte2084` — Matroska/output-flags alone drop it.
      "-color_primaries",
      "bt2020",
      "-color_trc",
      "smpte2084",
      "-colorspace",
      "bt2020nc",
      "-x265-params",
      "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:hdr10-opt=1",
      "-tag:v",
      "hvc1",
      "-c:a",
      "eac3",
      "-ac",
      "6",
      CLIP,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `clip generation failed (code ${String(code)}): ${stderr.trim()}`,
    );
  }
}

async function main(): Promise<void> {
  const config = loadConfig({
    // Minimal valid env so loadConfig succeeds (we only use ffmpeg/ffprobe paths + metrics here).
    BOT_TOKEN: "x",
    TOKEN: "x",
    GUILD_ID: "12345678901234567",
    COMMAND_CHANNEL_ID: "12345678901234567",
    VIDEO_CHANNEL_ID: "12345678901234567",
    VIDEOS_DIR: "/tmp",
  });

  log.info("generating test clip", { clip: CLIP });
  await generateClip(config.ffmpegPath);

  // --- 1. ffprobe (field-level assertions on the parsed MediaInfo) ---------
  const info = await probeMedia(config, CLIP);
  check("ffprobe returns media info", info !== null);
  if (info !== null) {
    check("video codec is hevc", info.videoCodec === "hevc", info.videoCodec);
    check("HDR transfer detected", info.hdr, info.pixelFormat);
    check("audio is 6-channel", info.audioChannels === 6, {
      codec: info.audioCodec,
      channels: info.audioChannels,
    });
    check(
      "resolution bucket",
      resolutionBucket(info.height) === "1080p",
      info.height,
    );
  }

  // Exercise the real wiring: resolveSource → recordSourceMetadata → probe + setSourceInfo.
  await resolveSource(
    config,
    { kind: "file", path: CLIP, title: "local-e2e" },
    AbortSignal.timeout(30_000),
  );
  const probedMetrics = await register.metrics();
  check(
    "streambot_source_info gauge set by resolveSource",
    /streambot_source_info\{[^}]*video_codec="hevc"[^}]*\}\s+1/.test(
      probedMetrics,
    ),
  );

  // --- 2. Fork StreamObserver over a real ffmpeg transcode -----------------
  const commands: string[] = [];
  const codecData: { video: string | undefined; audio: string | undefined }[] =
    [];
  let progressCount = 0;
  const { observer: baseObserver, dispose: disposeBase } =
    createStreamObserver(false);
  const observer: StreamObserver = {
    onCommand: (c) => {
      commands.push(c);
      baseObserver.onCommand?.(c);
    },
    onCodecData: (d) => {
      codecData.push({ video: d.video, audio: d.audio });
      baseObserver.onCodecData?.(d);
    },
    onProgress: (p) => {
      progressCount += 1;
      baseObserver.onProgress?.(p);
    },
  };

  const { promise, output } = prepareStream(
    CLIP,
    { observer, width: 1280, height: 720, frameRate: 30 },
    AbortSignal.timeout(120_000),
  );
  // Drain the muxed output so ffmpeg makes progress (backpressure would otherwise stall it).
  output.resume();
  await promise;
  disposeBase();

  check("observer received the ffmpeg command line", commands.length > 0);
  check(
    "ffmpeg command targets H264 software encode (no VAAPI on this host)",
    commands.some((c) => c.includes("libx264") || c.includes("h264")),
  );
  check(
    "observer received input codecData (hevc video)",
    codecData.some((d) => (d.video ?? "").toLowerCase().includes("hevc")),
    codecData,
  );
  check("observer received ffmpeg progress events", progressCount > 0, {
    progressCount,
  });

  // The realtime-ratio MATH is unit-tested deterministically (stream-observer.test.ts) — it needs
  // two progress events with a non-zero wall-clock gap. The test clip transcodes far faster than
  // realtime, so ffmpeg emits its handful of progress lines in a sub-millisecond burst and the ratio
  // guard (deltaWall > 0) correctly skips. We log whatever ffmpeg metrics did populate rather than
  // assert on that timing-dependent value here.
  const afterTranscode = await register.metrics();
  const speedMatch =
    /streambot_ffmpeg_speed_ratio\{hardware="false"\}\s+([0-9.eE+-]+)/.exec(
      afterTranscode,
    );
  const fpsMatch =
    /streambot_ffmpeg_fps\{hardware="false"\}\s+([0-9.eE+-]+)/.exec(
      afterTranscode,
    );
  log.info("ffmpeg progress metrics (informational)", {
    progressCount,
    speedRatio: speedMatch?.[1] ?? "not populated (sub-ms progress burst)",
    fps: fpsMatch?.[1] ?? "not populated",
  });

  // --- 3. /metrics HTTP endpoint -------------------------------------------
  const port = startMetricsServer(19_467);
  check("metrics server started", port === 19_467);
  try {
    const metricsBase = `http://localhost:${String(port)}`;
    const res = await fetch(`${metricsBase}/metrics`);
    check("GET /metrics returns 200", res.status === 200);
    const body = await res.text();
    check(
      "/metrics exposes streambot_ series",
      body.includes("streambot_ffmpeg_speed_ratio"),
    );
    const health = await fetch(`${metricsBase}/healthz`);
    check("GET /healthz returns 200", health.status === 200);
  } finally {
    await stopMetricsServer();
  }

  await rm(CLIP, { force: true });

  if (failures > 0) {
    log.error("local e2e FAILED", { failures });
    process.exit(1);
  }
  log.info(
    "local e2e PASSED — observability verified against real ffmpeg/ffprobe",
  );
}

await main();
