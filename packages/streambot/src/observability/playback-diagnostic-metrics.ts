import { Counter, Gauge, Histogram } from "prom-client";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";

const timingBuckets = [0.005, 0.01, 0.02, 0.0334, 0.05, 0.1, 0.2, 0.5, 1, 2, 5];
function timing(name: string, help: string) {
  return new Histogram({
    name,
    help,
    labelNames: ["kind"] as const,
    buckets: timingBuckets,
    registers: [register],
  });
}

export const sendIntervalSeconds = timing(
  "streambot_send_interval_seconds",
  "Interval between paced transport submissions, not network delivery",
);
export const sourceIdleSeconds = timing(
  "streambot_source_idle_seconds",
  "Time a paced sender waited for a source packet after its scheduled wait",
);
export const demuxIntervalSeconds = timing(
  "streambot_demux_interval_seconds",
  "Interval between encoded packets at the demux boundary, including consumer backpressure",
);
export const sendLatenessSeconds = timing(
  "streambot_send_lateness_seconds",
  "Paced submission lateness against the current schedule",
);
export const sendGapsTotal = new Counter({
  name: "streambot_send_gaps_total",
  help: "Paced transport submission intervals exceeding 200ms",
  labelNames: ["kind"] as const,
  registers: [register],
});
export const sourceStarvationsTotal = new Counter({
  name: "streambot_source_starvations_total",
  help: "Paced source idle intervals exceeding 200ms",
  labelNames: ["kind"] as const,
  registers: [register],
});
export const encodedPacketBytes = new Histogram({
  name: "streambot_encoded_packet_bytes",
  help: "Encoded packet sizes at the demux boundary",
  labelNames: ["kind", "frame_type"] as const,
  buckets: [256, 1024, 4096, 16_384, 65_536, 262_144, 1_048_576],
  registers: [register],
});
export const ffmpegFramesTotal = new Counter({
  name: "streambot_ffmpeg_frames_total",
  help: "FFmpeg frame production, duplication and drop counts accumulated across commands",
  labelNames: ["hardware", "action"] as const,
  registers: [register],
});
export const videoFeedbackTotal = new Counter({
  name: "streambot_video_feedback_total",
  help: "RTCP feedback from the immediate Discord peer, not viewers",
  labelNames: ["type"] as const,
  registers: [register],
});
export const videoSubmissionsTotal = new Counter({
  name: "streambot_video_submissions_total",
  help: "Local video submission outcomes; submitted means handed to native transport, not delivered",
  labelNames: ["outcome"] as const,
  registers: [register],
});
export const videoNackPacketsTotal = new Counter({
  name: "streambot_video_nack_packets_total",
  help: "Packets requested by immediate-peer video RTCP NACK feedback",
  registers: [register],
});
export const videoReceiverFractionLost = new Histogram({
  name: "streambot_video_receiver_fraction_lost",
  help: "Fraction lost reported by the immediate Discord peer",
  buckets: [0, 0.01, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});
export const videoReceiverJitterSeconds = new Histogram({
  name: "streambot_video_receiver_jitter_seconds",
  help: "Interarrival jitter reported by the immediate Discord peer",
  buckets: timingBuckets,
  registers: [register],
});
export const videoReceiverLastReportTimestampSeconds = new Gauge({
  name: "streambot_video_receiver_last_report_timestamp_seconds",
  help: "Latest immediate-peer receiver report timestamp among active pipelines, zero when none",
  registers: [register],
});
