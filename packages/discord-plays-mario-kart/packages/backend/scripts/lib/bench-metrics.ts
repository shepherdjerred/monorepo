// Parsing, summarising, and comparing the streamer's Prometheus `/metrics`
// for the e2e-perf-browser harness. Decoupled from the CLI so it can be
// exercised against a captured fixture in a unit test.

import { $ } from "bun";
import { BenchSummarySchema } from "./bench-summary-schema.ts";

export type ScrapedMetrics = {
  text: string;
  /** Wall-clock ms when the scrape was returned. */
  ts: number;
};

export async function scrape(metricsUrl: string): Promise<ScrapedMetrics> {
  const r = await fetch(metricsUrl, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) {
    throw new Error(
      `metrics fetch ${metricsUrl} -> HTTP ${String(r.status)}\n` +
        helpHint(metricsUrl),
    );
  }
  return { text: await r.text(), ts: Date.now() };
}

function helpHint(metricsUrl: string): string {
  const looksLocal = metricsUrl.startsWith("http://localhost");
  if (looksLocal) {
    return (
      "If you're testing against the live cluster, port-forward first:\n" +
      "  kubectl -n mario-kart port-forward svc/mario-kart-ui-service 18081:8081\n" +
      "then pass --metrics-url http://localhost:18081/metrics"
    );
  }
  return "";
}

// ---------------------------------------------------------------------------
// Prometheus text-format parsers. Tolerate arbitrary label order; ignore
// labels we don't filter on.
// ---------------------------------------------------------------------------

type MetricSample = {
  name: string;
  rawLabels: string;
  value: number;
};

const METRIC_LINE_PATTERN = /^([a-z_:][\w:]*)(?:\{([^}]*)\})?\s+(\S+)/i;
const LABEL_PATTERN = /(?:^|,)([a-z_]\w*)="((?:\\.|[^"\\])*)"/gi;

function metricSamples(text: string, name: string): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const line of text.split("\n")) {
    const match = METRIC_LINE_PATTERN.exec(line);
    if (match?.[1] !== name) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    samples.push({
      name: match[1],
      rawLabels: match[2] ?? "",
      value,
    });
  }
  return samples;
}

/** Build a label-set matcher. Tolerates extra labels and either order. */
function matchesLabels(
  rawLabels: string,
  required: Record<string, string>,
): boolean {
  const actual = new Map<string, string>();
  for (const match of rawLabels.matchAll(LABEL_PATTERN)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) actual.set(name, value);
  }
  for (const [name, value] of Object.entries(required)) {
    if (actual.get(name) !== value) return false;
  }
  return true;
}

/** Read a single counter or gauge value (no label-required match needed). */
function readNumber(
  text: string,
  name: string,
  labels?: Record<string, string>,
): number | null {
  for (const sample of metricSamples(text, name)) {
    if (labels === undefined || matchesLabels(sample.rawLabels, labels)) {
      return sample.value;
    }
  }
  return null;
}

export function counter(
  m: ScrapedMetrics,
  name: string,
  labels?: Record<string, string>,
): number {
  return readNumber(m.text, name, labels) ?? 0;
}

export function counterSum(m: ScrapedMetrics, name: string): number {
  return metricSamples(m.text, name).reduce(
    (sum, sample) => sum + sample.value,
    0,
  );
}

export function gauge(
  m: ScrapedMetrics,
  name: string,
  labels?: Record<string, string>,
): number | null {
  return readNumber(m.text, name, labels);
}

/**
 * Computes the value of `name`_bucket at the lowest `le` whose cumulative
 * count covers `q` of the total samples. This is the same lifetime-quantile
 * approximation the existing histogramP95 in e2e-perf-browser.ts does, but
 * generalised to any quantile and label set.
 *
 * Returns NaN when the histogram has zero samples (so callers can skip /
 * report "no data" rather than show a misleading 0).
 */
export function histogramQuantile(
  m: ScrapedMetrics,
  name: string,
  q: number,
  labels?: Record<string, string>,
): number {
  const rows: { le: number; cum: number }[] = [];
  for (const sample of metricSamples(m.text, `${name}_bucket`)) {
    const rawLabels = sample.rawLabels;
    const leMatch = /(?:^|,)le="([^"]+)"(?:,|$)/.exec(rawLabels);
    const leRaw = leMatch?.[1];
    if (
      leRaw !== undefined &&
      (labels === undefined || matchesLabels(rawLabels, labels))
    ) {
      const le = leRaw === "+Inf" ? Number.POSITIVE_INFINITY : Number(leRaw);
      rows.push({ le, cum: sample.value });
    }
  }
  rows.sort((a, b) => a.le - b.le);
  const last = rows.at(-1);
  if (last === undefined || last.cum === 0) return Number.NaN;
  const target = last.cum * q;
  for (const row of rows) if (row.cum >= target) return row.le;
  return Number.POSITIVE_INFINITY;
}

// ---------------------------------------------------------------------------
// Gauge polling — gauges only carry the instantaneous value; min/mean across
// the measurement window require sampling on a timer.
// ---------------------------------------------------------------------------

export type GaugePoll = {
  ffmpeg_speed_ratio: number[];
  ffmpeg_fps: number[];
  ffmpeg_bitrate_kbps: number[];
  sink_buffer_bytes: number[];
  hw_encode_engaged: number[];
  stream_active: number[];
  av_content_offset_ms: number[];
};

export function emptyGaugePoll(): GaugePoll {
  return {
    ffmpeg_speed_ratio: [],
    ffmpeg_fps: [],
    ffmpeg_bitrate_kbps: [],
    sink_buffer_bytes: [],
    hw_encode_engaged: [],
    stream_active: [],
    av_content_offset_ms: [],
  };
}

function pushNonNull(arr: number[], v: number | null): void {
  if (v !== null) arr.push(v);
}

export function sampleGauges(m: ScrapedMetrics, poll: GaugePoll): void {
  pushNonNull(poll.ffmpeg_speed_ratio, gauge(m, "stream_ffmpeg_speed_ratio"));
  pushNonNull(poll.ffmpeg_fps, gauge(m, "stream_ffmpeg_fps"));
  pushNonNull(poll.ffmpeg_bitrate_kbps, gauge(m, "stream_ffmpeg_bitrate_kbps"));
  pushNonNull(poll.sink_buffer_bytes, gauge(m, "stream_sink_buffer_bytes"));
  pushNonNull(poll.hw_encode_engaged, gauge(m, "stream_hw_encode_engaged"));
  pushNonNull(poll.stream_active, gauge(m, "stream_active"));
  pushNonNull(
    poll.av_content_offset_ms,
    gauge(m, "stream_av_content_offset_ms"),
  );
}

function summariseGauge(samples: number[]): {
  min: number | null;
  mean: number | null;
  max: number | null;
  last: number | null;
} {
  if (samples.length === 0) {
    return { min: null, mean: null, max: null, last: null };
  }
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...samples),
    mean: sum / samples.length,
    max: Math.max(...samples),
    last: samples.at(-1) ?? null,
  };
}

// ---------------------------------------------------------------------------
// BenchSummary — the persisted JSON shape. Versioned so future runs can diff
// against older baselines and warn about schema drift.
// ---------------------------------------------------------------------------

export const BENCH_SUMMARY_VERSION = 2;

export type BenchSummary = {
  version: number;
  ts: string;
  target: string;
  metrics_url: string;
  duration_sec: number;
  seats: number;
  git: { sha: string; branch: string; dirty: boolean };
  emulator: {
    fps_mean: number;
    emulate_ms_p95: number | null;
    late_ms_p95: number | null;
    apply_ms_p95: number | null;
    resync_delta: number;
    ticks_delta: number;
  };
  stream: {
    active_last: number | null;
    hw_encode_engaged: number | null;
    ffmpeg_speed_ratio: {
      min: number | null;
      mean: number | null;
      last: number | null;
    };
    ffmpeg_fps: { min: number | null; mean: number | null };
    ffmpeg_bitrate_kbps: { mean: number | null };
    frame_interval_ms_p50: number | null;
    frame_interval_ms_p95: number | null;
    frame_write_ms_p95: number | null;
    sink_buffer_bytes_max: number | null;
    send_frametime_ratio_video_p50: number | null;
    send_frametime_ratio_video_p95: number | null;
    send_frametime_ratio_audio_p50: number | null;
    send_frametime_ratio_audio_p95: number | null;
    send_late_frames_video_delta: number;
    send_late_frames_audio_delta: number;
    packet_ready_delay_video_p95: number | null;
    packet_ready_delay_audio_p95: number | null;
    send_complete_delay_video_p95: number | null;
    send_complete_delay_audio_p95: number | null;
    av_content_offset_ms: {
      min: number | null;
      mean: number | null;
      max: number | null;
      last: number | null;
    };
    av_content_skew_abs_ms_p95: number | null;
    latency_correlation_failures_delta: number;
  };
  input: {
    controller_rtt_ms_p50: number | null;
    controller_rtt_ms_p95: number | null;
    input_apply_delay_ms_p50: number | null;
    input_apply_delay_ms_p95: number | null;
    input_to_packet_ready_ms_p95: number | null;
    input_to_send_complete_ms_p95: number | null;
  };
};

export type BuildSummaryInput = {
  target: string;
  metricsUrl: string;
  durationSec: number;
  seats: number;
  git: { sha: string; branch: string; dirty: boolean };
  benchStartedAt: Date;
  start: ScrapedMetrics;
  end: ScrapedMetrics;
  poll: GaugePoll;
  wallSec: number;
};

function nanToNull(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

export function buildSummary(input: BuildSummaryInput): BenchSummary {
  const { start, end, poll, wallSec } = input;
  const ticksDelta =
    counter(end, "emulator_ticks_total") -
    counter(start, "emulator_ticks_total");
  const resyncDelta =
    counter(end, "emulator_loop_resync_total") -
    counter(start, "emulator_loop_resync_total");
  const speed = summariseGauge(poll.ffmpeg_speed_ratio);
  const fps = summariseGauge(poll.ffmpeg_fps);
  const bitrate = summariseGauge(poll.ffmpeg_bitrate_kbps);
  const sink = summariseGauge(poll.sink_buffer_bytes);
  const hwLast = summariseGauge(poll.hw_encode_engaged).last;
  const activeLast = summariseGauge(poll.stream_active).last;
  const avOffset = summariseGauge(poll.av_content_offset_ms);
  return {
    version: BENCH_SUMMARY_VERSION,
    ts: input.benchStartedAt.toISOString(),
    target: input.target,
    metrics_url: input.metricsUrl,
    duration_sec: input.durationSec,
    seats: input.seats,
    git: input.git,
    emulator: {
      fps_mean: wallSec > 0 ? ticksDelta / wallSec : 0,
      emulate_ms_p95: nanToNull(
        histogramQuantile(end, "emulator_frame_emulate_ms", 0.95),
      ),
      late_ms_p95: nanToNull(
        histogramQuantile(end, "emulator_frame_late_ms", 0.95),
      ),
      apply_ms_p95: nanToNull(
        histogramQuantile(end, "emulator_input_apply_delay_ms", 0.95),
      ),
      resync_delta: resyncDelta,
      ticks_delta: ticksDelta,
    },
    stream: {
      active_last: activeLast,
      hw_encode_engaged: hwLast,
      ffmpeg_speed_ratio: {
        min: speed.min,
        mean: speed.mean,
        last: speed.last,
      },
      ffmpeg_fps: { min: fps.min, mean: fps.mean },
      ffmpeg_bitrate_kbps: { mean: bitrate.mean },
      frame_interval_ms_p50: nanToNull(
        histogramQuantile(end, "stream_frame_interval_ms", 0.5),
      ),
      frame_interval_ms_p95: nanToNull(
        histogramQuantile(end, "stream_frame_interval_ms", 0.95),
      ),
      frame_write_ms_p95: nanToNull(
        histogramQuantile(end, "stream_frame_write_ms", 0.95),
      ),
      sink_buffer_bytes_max: sink.max,
      send_frametime_ratio_video_p50: nanToNull(
        histogramQuantile(end, "stream_send_frametime_ratio", 0.5, {
          kind: "video",
        }),
      ),
      send_frametime_ratio_video_p95: nanToNull(
        histogramQuantile(end, "stream_send_frametime_ratio", 0.95, {
          kind: "video",
        }),
      ),
      send_frametime_ratio_audio_p50: nanToNull(
        histogramQuantile(end, "stream_send_frametime_ratio", 0.5, {
          kind: "audio",
        }),
      ),
      send_frametime_ratio_audio_p95: nanToNull(
        histogramQuantile(end, "stream_send_frametime_ratio", 0.95, {
          kind: "audio",
        }),
      ),
      send_late_frames_video_delta:
        counter(end, "stream_send_late_frames_total", { kind: "video" }) -
        counter(start, "stream_send_late_frames_total", { kind: "video" }),
      send_late_frames_audio_delta:
        counter(end, "stream_send_late_frames_total", { kind: "audio" }) -
        counter(start, "stream_send_late_frames_total", { kind: "audio" }),
      packet_ready_delay_video_p95: nanToNull(
        histogramQuantile(end, "stream_packet_ready_delay_ms", 0.95, {
          kind: "video",
        }),
      ),
      packet_ready_delay_audio_p95: nanToNull(
        histogramQuantile(end, "stream_packet_ready_delay_ms", 0.95, {
          kind: "audio",
        }),
      ),
      send_complete_delay_video_p95: nanToNull(
        histogramQuantile(end, "stream_send_complete_delay_ms", 0.95, {
          kind: "video",
        }),
      ),
      send_complete_delay_audio_p95: nanToNull(
        histogramQuantile(end, "stream_send_complete_delay_ms", 0.95, {
          kind: "audio",
        }),
      ),
      av_content_offset_ms: {
        min: avOffset.min,
        mean: avOffset.mean,
        max: avOffset.max,
        last: avOffset.last,
      },
      av_content_skew_abs_ms_p95: nanToNull(
        histogramQuantile(end, "stream_av_content_skew_abs_ms", 0.95),
      ),
      latency_correlation_failures_delta:
        counterSum(end, "stream_latency_correlation_failures_total") -
        counterSum(start, "stream_latency_correlation_failures_total"),
    },
    input: {
      controller_rtt_ms_p50: nanToNull(
        histogramQuantile(end, "controller_rtt_ms", 0.5),
      ),
      controller_rtt_ms_p95: nanToNull(
        histogramQuantile(end, "controller_rtt_ms", 0.95),
      ),
      input_apply_delay_ms_p50: nanToNull(
        histogramQuantile(end, "emulator_input_apply_delay_ms", 0.5),
      ),
      input_apply_delay_ms_p95: nanToNull(
        histogramQuantile(end, "emulator_input_apply_delay_ms", 0.95),
      ),
      input_to_packet_ready_ms_p95: nanToNull(
        histogramQuantile(end, "stream_input_to_packet_ready_ms", 0.95),
      ),
      input_to_send_complete_ms_p95: nanToNull(
        histogramQuantile(end, "stream_input_to_send_complete_ms", 0.95),
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// git metadata stamp
// ---------------------------------------------------------------------------

export async function gitMetadata(): Promise<{
  sha: string;
  branch: string;
  dirty: boolean;
}> {
  // Tolerate environments where git is unavailable (e.g., running in a
  // packaged release); fall back to empty strings so the JSON is still well
  // formed.
  try {
    const shaText = await $`git rev-parse HEAD`.text();
    const branchText = await $`git rev-parse --abbrev-ref HEAD`.text();
    const statusText = await $`git status --porcelain`.text();
    return {
      sha: shaText.trim(),
      branch: branchText.trim(),
      dirty: statusText.trim().length > 0,
    };
  } catch {
    return { sha: "", branch: "", dirty: false };
  }
}

// ---------------------------------------------------------------------------
// Zod schema for parsing a baseline JSON. Used by --compare so we never lean
// on an `as` type assertion to widen JSON.parse output (custom-rules
// no-type-assertions). The schema mirrors BenchSummary 1:1; if the JSON
// fails to parse, the caller gets a clear ZodError that names the offending
// path.
// ---------------------------------------------------------------------------

export function parseBenchSummary(raw: unknown): BenchSummary {
  return BenchSummarySchema.parse(raw);
}
