// Diffing two BenchSummary JSON snapshots into a side-by-side delta table.
// Used by `e2e-perf-browser.ts --compare <baseline.json>` to validate the
// expected direction of change after shipping a fix.

import type { BenchSummary } from "./bench-metrics.ts";

export type Direction = "higher" | "lower" | "equal";
export type Verdict = "improved" | "regressed" | "ok" | "n/a";

type MetricDef = {
  /** Dotted path inside BenchSummary, e.g. `stream.frame_interval_ms_p95`. */
  path: string;
  /** Whether higher / lower / equal is the desirable direction. */
  direction: Direction;
};

const METRIC_DEFS: MetricDef[] = [
  { path: "emulator.fps_mean", direction: "higher" },
  { path: "emulator.emulate_ms_p95", direction: "lower" },
  { path: "emulator.late_ms_p95", direction: "lower" },
  { path: "emulator.apply_ms_p95", direction: "lower" },
  { path: "emulator.resync_delta", direction: "lower" },
  { path: "stream.active_last", direction: "equal" },
  { path: "stream.hw_encode_engaged", direction: "equal" },
  { path: "stream.ffmpeg_speed_ratio.mean", direction: "higher" },
  { path: "stream.ffmpeg_speed_ratio.min", direction: "higher" },
  { path: "stream.ffmpeg_fps.mean", direction: "higher" },
  { path: "stream.ffmpeg_fps.min", direction: "higher" },
  { path: "stream.ffmpeg_bitrate_kbps.mean", direction: "higher" },
  { path: "stream.frame_interval_ms_p50", direction: "lower" },
  { path: "stream.frame_interval_ms_p95", direction: "lower" },
  { path: "stream.frame_write_ms_p95", direction: "lower" },
  { path: "stream.sink_buffer_bytes_max", direction: "lower" },
  { path: "stream.send_frametime_ratio_video_p50", direction: "lower" },
  { path: "stream.send_frametime_ratio_video_p95", direction: "lower" },
  { path: "stream.send_frametime_ratio_audio_p50", direction: "lower" },
  { path: "stream.send_frametime_ratio_audio_p95", direction: "lower" },
  { path: "stream.send_late_frames_video_delta", direction: "lower" },
  { path: "stream.send_late_frames_audio_delta", direction: "lower" },
  { path: "input.controller_rtt_ms_p50", direction: "lower" },
  { path: "input.controller_rtt_ms_p95", direction: "lower" },
  { path: "input.input_apply_delay_ms_p50", direction: "lower" },
  { path: "input.input_apply_delay_ms_p95", direction: "lower" },
];

function dig(obj: unknown, dottedPath: string): number | null {
  let cur: unknown = obj;
  for (const part of dottedPath.split(".")) {
    if (cur === null || typeof cur !== "object") return null;
    // Reflect.get returns `any` (no cast needed) and safely returns
    // undefined when the key isn't present — exactly the indexed-access
    // semantics we want for a JSON walk without an `as` cast.
    cur = Reflect.get(cur, part);
  }
  return typeof cur === "number" ? cur : null;
}

export type CompareRow = {
  metric: string;
  direction: Direction;
  baseline: number | null;
  current: number | null;
  delta: number | null;
  /** Relative change vs baseline, in the unit baseline is in. Null if baseline is 0/null. */
  relative: number | null;
  verdict: Verdict;
};

export function compareSummaries(
  baseline: BenchSummary,
  current: BenchSummary,
  relativeThreshold = 0.05,
): CompareRow[] {
  return METRIC_DEFS.map((def) => {
    const b = dig(baseline, def.path);
    const c = dig(current, def.path);
    if (b === null || c === null) {
      return {
        metric: def.path,
        direction: def.direction,
        baseline: b,
        current: c,
        delta: null,
        relative: null,
        verdict: "n/a",
      };
    }
    const delta = c - b;
    const relative = b === 0 ? null : delta / b;
    let verdict: Verdict;
    if (def.direction === "equal") {
      verdict = delta === 0 ? "ok" : "regressed";
    } else {
      const within =
        relative === null
          ? Math.abs(delta) < 1e-9
          : Math.abs(relative) < relativeThreshold;
      if (within) {
        verdict = "ok";
      } else if (def.direction === "higher") {
        verdict = delta > 0 ? "improved" : "regressed";
      } else {
        verdict = delta < 0 ? "improved" : "regressed";
      }
    }
    return {
      metric: def.path,
      direction: def.direction,
      baseline: b,
      current: c,
      delta,
      relative,
      verdict,
    };
  });
}

function fmt(v: number | null, digits = 2): string {
  if (v === null) return "—";
  if (!Number.isFinite(v)) return String(v);
  return Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(digits);
}

function joinRow(cells: string[], widths: number[]): string {
  return cells.map((c, i) => c.padEnd(widths[i])).join("  ");
}

export function renderCompareTable(rows: CompareRow[]): string {
  const header = ["metric", "baseline", "current", "Δ", "Δ%", "verdict"];
  const data = rows.map((r) => [
    r.metric,
    fmt(r.baseline),
    fmt(r.current),
    fmt(r.delta),
    r.relative === null ? "—" : `${(r.relative * 100).toFixed(1)}%`,
    r.verdict,
  ]);
  const cols = header.length;
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(header[i].length, ...data.map((row) => row[i].length)),
  );
  return [
    joinRow(header, widths),
    joinRow(
      widths.map((w) => "-".repeat(w)),
      widths,
    ),
    ...data.map((row) => joinRow(row, widths)),
  ].join("\n");
}
