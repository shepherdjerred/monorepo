import type {
  FfmpegProgress,
  StreamObserver,
} from "@shepherdjerred/discord-video-stream";
import { randomUUID } from "node:crypto";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";
import { getTracer } from "@shepherdjerred/streambot/observability/tracing.ts";
import type { OwnedPlaybackGauges } from "@shepherdjerred/streambot/observability/owned-playback-gauges.ts";
import {
  demuxIntervalSeconds,
  encodedPacketBytes,
  ffmpegFramesTotal,
  sendGapsTotal,
  sendIntervalSeconds,
  sendLatenessSeconds,
  sourceIdleSeconds,
  sourceStarvationsTotal,
  videoFeedbackTotal,
  videoNackPacketsTotal,
  videoReceiverFractionLost,
  videoReceiverJitterSeconds,
  videoReceiverLastReportTimestampSeconds,
  videoSubmissionsTotal,
} from "@shepherdjerred/streambot/observability/playback-diagnostic-metrics.ts";

const log = logger.child("streamer:diagnostics");
type Kind = "video" | "audio";
type FrameAction = "produced" | "duplicated" | "dropped";
export type PlaybackDiagnosticContext = {
  transport: "voice" | "go-live";
  pipelineMode: "hw" | "hw-upload" | "sw";
  offsetSeconds: () => number;
};

/** Aggregation preserves brief anomalies across scrapes without retaining frames or payloads. */
export function createPlaybackDiagnostics(
  hardware: string,
  now: () => number,
  gauges: OwnedPlaybackGauges,
  options: {
    context: PlaybackDiagnosticContext | undefined;
    progressAgeSeconds: () => number;
  },
) {
  const { context, progressAgeSeconds } = options;
  const segment = randomUUID();
  let epoch = 0;
  let queueDepth = { video: 0, audio: 0 };
  let previousPacketAt: Partial<Record<Kind, number>> = {};
  let previousFrames: Partial<Record<FrameAction, number>> = {};
  let lastAnomalyAt = -Infinity;
  let disposed = false;

  const reset = () => {
    epoch++;
    queueDepth = { video: 0, audio: 0 };
    previousPacketAt = {};
    previousFrames = {};
    lastAnomalyAt = -Infinity;
  };
  const onProgress = (progress: FfmpegProgress) => {
    if (disposed) return;
    const counts = {
      produced: progress.frames,
      duplicated: progress.duplicatedFrames,
      dropped: progress.droppedFrames,
    };
    for (const action of ["produced", "duplicated", "dropped"] as const) {
      const count = counts[action];
      if (count === undefined || !Number.isFinite(count) || count < 0) continue;
      const previous = previousFrames[action] ?? 0;
      // Commands restart counters; never decrease a process-lifetime Prometheus counter.
      ffmpegFramesTotal.inc(
        { hardware, action },
        count >= previous ? count - previous : count,
      );
      previousFrames[action] = count;
    }
  };
  const observer = {
    onPacketReady: (stats) => {
      if (disposed) return;
      const at = now();
      const previous = previousPacketAt[stats.kind];
      if (previous !== undefined)
        demuxIntervalSeconds.observe(
          { kind: stats.kind },
          Math.max(0, at - previous) / 1000,
        );
      previousPacketAt[stats.kind] = at;
      if (stats.bytes !== undefined)
        encodedPacketBytes.observe(
          {
            kind: stats.kind,
            frame_type:
              stats.kind === "audio"
                ? "audio"
                : stats.keyframe === true
                  ? "key"
                  : "delta",
          },
          stats.bytes,
        );
    },
    onSendStats: (stats) => {
      if (disposed || stats.paced === false) return;
      const labels = { kind: stats.kind };
      sendLatenessSeconds.observe(labels, stats.behindMs / 1000);
      if (stats.sendIntervalMs !== undefined) {
        sendIntervalSeconds.observe(labels, stats.sendIntervalMs / 1000);
        if (stats.sendIntervalMs > 200) sendGapsTotal.inc(labels);
      }
      if (stats.sourceIdleMs !== undefined) {
        sourceIdleSeconds.observe(labels, stats.sourceIdleMs / 1000);
        if (stats.sourceIdleMs > 200) sourceStarvationsTotal.inc(labels);
      }
      const severityMs = Math.max(
        stats.sendIntervalMs ?? 0,
        stats.sourceIdleMs ?? 0,
        stats.behindMs,
      );
      const at = now();
      if (severityMs <= 200 || at - lastAnomalyAt < 5000) return;
      lastAnomalyAt = at;
      const fields = {
        segment,
        epoch,
        hardware,
        transport: context?.transport ?? "go-live",
        pipelineMode:
          context?.pipelineMode ?? (hardware === "true" ? "hw" : "sw"),
        positionSeconds: (context?.offsetSeconds() ?? 0) + stats.ptsMs / 1000,
        progressAgeSeconds: progressAgeSeconds(),
        videoQueueDepth: queueDepth.video,
        audioQueueDepth: queueDepth.audio,
        kind: stats.kind,
        ptsMs: Math.round(stats.ptsMs),
        sendIntervalMs: Math.round(stats.sendIntervalMs ?? 0),
        sourceIdleMs: Math.round(stats.sourceIdleMs ?? 0),
        behindMs: Math.round(stats.behindMs),
      };
      getTracer().startActiveSpan(
        "streambot.playback.anomaly",
        { attributes: fields },
        (span) => {
          log.warn("playback timing anomaly", fields);
          span.end();
        },
      );
    },
    onQueueDepth: (depth) => {
      queueDepth = depth;
    },
    onVideoFeedback: (event) => {
      if (disposed) return;
      videoFeedbackTotal.inc({ type: event.type });
      if (event.type === "nack")
        videoNackPacketsTotal.inc(event.requestedPackets);
      if (event.type === "receiver-report") {
        videoReceiverFractionLost.observe(event.fractionLost);
        videoReceiverJitterSeconds.observe(event.jitterSeconds);
        gauges.set(
          videoReceiverLastReportTimestampSeconds,
          {},
          now() / 1000,
          "max",
        );
      }
    },
    onVideoSubmission: (event) => {
      if (disposed) return;
      videoSubmissionsTotal.inc({ outcome: event.outcome });
    },
  } satisfies StreamObserver;
  return {
    observer,
    reset,
    onProgress,
    dispose: () => {
      disposed = true;
    },
  };
}
