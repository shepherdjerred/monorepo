/**
 * Optional observability seam. A consumer (e.g. streambot) can pass a {@link StreamObserver} via the
 * prepare/play options to receive the runtime signals the pipeline already computes but otherwise
 * only writes to debug logs: the ffmpeg command line, input codec/resolution, realtime transcode
 * progress (fps/bitrate/timemark), and per-frame send timing. All callbacks are optional and the
 * pipeline behaves identically when no observer is supplied — this adds visibility, never behavior.
 */

/** Input stream metadata as parsed by ffmpeg's `codecData` event (one-shot, at stream start). */
export type FfmpegCodecData = {
  format?: string;
  duration?: string;
  /** e.g. "hevc (Main 10)" */
  video?: string;
  /** e.g. "truehd" */
  audio?: string;
  /** e.g. ["yuv420p10le(tv, bt2020nc/bt2020/smpte2084)", ...] — pixel format + HDR transfer details. */
  video_details?: string[];
  audio_details?: string[];
};

/**
 * ffmpeg transcode progress, emitted ~once per second. fluent-ffmpeg does not surface a realtime
 * `speed` figure, so consumers derive the realtime ratio from `timemark` (media time) advance vs
 * wall-clock instead.
 */
export type FfmpegProgress = {
  frames?: number;
  currentFps?: number;
  currentKbps?: number;
  targetSize?: number;
  timemark?: string;
  percent?: number;
};

/** Per-frame send timing from the realtime media send path. `ratio > 1` means the frame was late. */
export type SendStats = {
  kind: "video" | "audio";
  /** sendTime / frametime — the fraction of the frame's wall-clock budget the send consumed. */
  ratio: number;
  /** Wall-clock milliseconds spent sending this frame. */
  sendTime: number;
  /** The frame's duration (budget) in milliseconds. */
  frametime: number;
  /**
   * How late this frame was sent versus its absolute pacing schedule (wall-elapsed minus
   * media-elapsed since the current anchor), in milliseconds; 0 when on schedule or unanchored.
   * The direct sender-side measure of viewer-facing lateness — the signal the 2026-07-18 stutter
   * investigation had to infer from production-rate proxies.
   */
  behindMs: number;
  /** Wall-clock ms spent waiting in the A/V ahead-sync loop before completing this frame (usually 0). */
  syncWaitMs: number;
  /** A/V sync correction taken on this frame, if any. Each correction re-anchors the schedule. */
  syncEvent?: "ahead" | "behind";
};

/** Buffered packet counts between the demuxer and the paced send streams. */
export type QueueDepth = {
  /** Packets buffered in the video demux→pacer queue (objectMode stream lengths). */
  video: number;
  /** Packets buffered in the audio demux→pacer queue; 0 when the source has no audio. */
  audio: number;
};

export type StreamObserver = {
  /** The full ffmpeg command line (fluent-ffmpeg `start` event) — reveals which decode/scale flags applied. */
  onCommand?: (command: string) => void;
  /**
   * The ffmpeg subprocess PID, once available. Lets the consumer attribute per-process resource
   * counters that live on the host (e.g. `/proc/<pid>/fdinfo/<drm_fd>` `drm-engine-*` for per-pod
   * GPU work attribution, when `/dev/dri/renderD128` is shared with other tenants).
   */
  onProcessStart?: (pid: number) => void;
  /** Input codec/resolution/duration (fluent-ffmpeg `codecData` event), once at stream start. */
  onCodecData?: (data: FfmpegCodecData) => void;
  /** Periodic transcode progress (fluent-ffmpeg `progress` event). */
  onProgress?: (progress: FfmpegProgress) => void;
  /** Per-frame send timing from the video/audio send path. High volume — sample/aggregate downstream. */
  onSendStats?: (stats: SendStats) => void;
  /**
   * Periodic (~5 s) demux→pacer queue depths. Separates producer-starved dips (queues empty) from
   * consumer-paced backpressure (queues full) — the distinction that required in-pod thread
   * sampling to establish during the 2026-07-18 stutter investigation.
   */
  onQueueDepth?: (depth: QueueDepth) => void;
};
