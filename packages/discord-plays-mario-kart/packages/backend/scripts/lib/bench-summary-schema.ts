import { z } from "zod";

const NullableNumber = z.number().nullable();
const GaugeMinMeanLast = z.object({
  min: NullableNumber,
  mean: NullableNumber,
  last: NullableNumber,
});
const GaugeMinMean = z.object({ min: NullableNumber, mean: NullableNumber });
const GaugeMean = z.object({ mean: NullableNumber });
const GaugeMinMeanMaxLast = z.object({
  min: NullableNumber,
  mean: NullableNumber,
  max: NullableNumber,
  last: NullableNumber,
});

export const BenchSummarySchema = z.object({
  version: z.number(),
  ts: z.string(),
  target: z.string(),
  metrics_url: z.string(),
  duration_sec: z.number(),
  seats: z.number(),
  git: z.object({ sha: z.string(), branch: z.string(), dirty: z.boolean() }),
  emulator: z.object({
    fps_mean: z.number(),
    emulate_ms_p95: NullableNumber,
    late_ms_p95: NullableNumber,
    apply_ms_p95: NullableNumber,
    resync_delta: z.number(),
    ticks_delta: z.number(),
  }),
  stream: z.object({
    active_last: NullableNumber,
    hw_encode_engaged: NullableNumber,
    ffmpeg_speed_ratio: GaugeMinMeanLast,
    ffmpeg_fps: GaugeMinMean,
    ffmpeg_bitrate_kbps: GaugeMean,
    frame_interval_ms_p50: NullableNumber,
    frame_interval_ms_p95: NullableNumber,
    frame_write_ms_p95: NullableNumber,
    sink_buffer_bytes_max: NullableNumber,
    send_frametime_ratio_video_p50: NullableNumber,
    send_frametime_ratio_video_p95: NullableNumber,
    send_frametime_ratio_audio_p50: NullableNumber,
    send_frametime_ratio_audio_p95: NullableNumber,
    send_late_frames_video_delta: z.number(),
    send_late_frames_audio_delta: z.number(),
    packet_ready_delay_video_p95: NullableNumber.default(null),
    packet_ready_delay_audio_p95: NullableNumber.default(null),
    send_complete_delay_video_p95: NullableNumber.default(null),
    send_complete_delay_audio_p95: NullableNumber.default(null),
    av_content_offset_ms: GaugeMinMeanMaxLast.default({
      min: null,
      mean: null,
      max: null,
      last: null,
    }),
    av_content_skew_abs_ms_p95: NullableNumber.default(null),
    latency_correlation_failures_delta: z.number().default(0),
  }),
  input: z.object({
    controller_rtt_ms_p50: NullableNumber,
    controller_rtt_ms_p95: NullableNumber,
    input_apply_delay_ms_p50: NullableNumber,
    input_apply_delay_ms_p95: NullableNumber,
    input_to_packet_ready_ms_p95: NullableNumber.default(null),
    input_to_send_complete_ms_p95: NullableNumber.default(null),
  }),
});
