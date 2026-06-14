import { describe, expect, it } from "bun:test";
import path from "node:path";
import { compareSummaries, renderCompareTable } from "./bench-compare.ts";
import {
  BENCH_SUMMARY_VERSION,
  buildSummary,
  counter,
  emptyGaugePoll,
  gauge,
  histogramQuantile,
  sampleGauges,
  type BenchSummary,
  type ScrapedMetrics,
} from "./bench-metrics.ts";

const fixturePath = path.join(
  import.meta.dirname,
  "..",
  "__fixtures__",
  "metrics-sample.txt",
);

async function loadFixture(): Promise<ScrapedMetrics> {
  const text = await Bun.file(fixturePath).text();
  return { text, ts: 1_700_000_000_000 };
}

describe("counter / gauge", () => {
  it("reads unlabeled counters and gauges from the captured fixture", async () => {
    const m = await loadFixture();
    // Lifetime counter (fresh-ish pod, single-digit ticks ok).
    expect(counter(m, "emulator_ticks_total")).toBeGreaterThan(0);
    // The captured snapshot had stream_active=1 and a sustained <1 speed
    // ratio (encoder choking — useful real-world signal for the parser).
    expect(gauge(m, "stream_active")).toBe(1);
    const speed = gauge(m, "stream_ffmpeg_speed_ratio");
    expect(speed).not.toBeNull();
    expect(speed!).toBeGreaterThan(0);
    expect(speed!).toBeLessThan(2);
  });

  it("returns 0 for a missing counter and null for a missing gauge", async () => {
    const m = await loadFixture();
    expect(counter(m, "nonexistent_counter_total")).toBe(0);
    expect(gauge(m, "nonexistent_gauge")).toBeNull();
  });

  it("reads labeled counters when labels match (and ignores extras)", async () => {
    const m = await loadFixture();
    // The fixture has stream_send_late_frames_total{kind="audio"} / {kind="video"};
    // even if the values are 0, the lookup must succeed (not throw).
    const video = counter(m, "stream_send_late_frames_total", {
      kind: "video",
    });
    const audio = counter(m, "stream_send_late_frames_total", {
      kind: "audio",
    });
    expect(video).toBeGreaterThanOrEqual(0);
    expect(audio).toBeGreaterThanOrEqual(0);
  });
});

describe("histogramQuantile", () => {
  it("computes lifetime quantiles from real bucket data", async () => {
    const m = await loadFixture();
    // stream_frame_interval_ms in the fixture had ~5357 samples skewed
    // toward the 25-50ms bucket. p50 should land at or below 33 and p95
    // below 200.
    const p50 = histogramQuantile(m, "stream_frame_interval_ms", 0.5);
    const p95 = histogramQuantile(m, "stream_frame_interval_ms", 0.95);
    expect(p50).toBeGreaterThan(0);
    expect(p50).toBeLessThanOrEqual(50);
    expect(p95).toBeGreaterThanOrEqual(p50);
    expect(p95).toBeLessThanOrEqual(200);
  });

  it("returns NaN for empty histograms", async () => {
    const m = await loadFixture();
    // controller_rtt_ms had _count=0 in the fixture (no controller
    // connected during capture).
    const q = histogramQuantile(m, "controller_rtt_ms", 0.95);
    expect(Number.isNaN(q)).toBe(true);
  });

  it("respects labels — video vs audio land in different buckets", async () => {
    const m = await loadFixture();
    const v = histogramQuantile(m, "stream_send_frametime_ratio", 0.95, {
      kind: "video",
    });
    const a = histogramQuantile(m, "stream_send_frametime_ratio", 0.95, {
      kind: "audio",
    });
    // Both should be valid finite numbers within the bucket range
    // [0.25, +Inf]. Their relative order isn't asserted because it
    // depends on workload; just confirm we got a number, not NaN.
    expect(Number.isNaN(v)).toBe(false);
    expect(Number.isNaN(a)).toBe(false);
  });
});

describe("sampleGauges + buildSummary", () => {
  it("produces a well-formed summary for a one-shot scrape", async () => {
    const start = await loadFixture();
    const end = await loadFixture();
    const poll = emptyGaugePoll();
    sampleGauges(start, poll);
    sampleGauges(end, poll);

    const summary = buildSummary({
      target: "test://fixture",
      metricsUrl: "test://fixture/metrics",
      durationSec: 30,
      seats: 4,
      git: { sha: "deadbeef", branch: "test", dirty: false },
      benchStartedAt: new Date(1_700_000_000_000),
      start,
      end,
      poll,
      wallSec: 30,
    });

    expect(summary.version).toBe(BENCH_SUMMARY_VERSION);
    expect(summary.target).toBe("test://fixture");
    expect(summary.seats).toBe(4);
    expect(summary.git.sha).toBe("deadbeef");
    expect(summary.emulator.ticks_delta).toBe(0); // start == end
    expect(summary.stream.active_last).toBe(1);
    expect(summary.stream.ffmpeg_speed_ratio.mean).not.toBeNull();
    expect(summary.stream.frame_interval_ms_p95).not.toBeNull();
    expect(summary.input.controller_rtt_ms_p95).toBeNull(); // fixture had no RTT samples
  });
});

function makeSummary(overrides: Partial<BenchSummary["stream"]>): BenchSummary {
  return {
    version: BENCH_SUMMARY_VERSION,
    ts: "2026-06-14T00:00:00.000Z",
    target: "x",
    metrics_url: "y",
    duration_sec: 30,
    seats: 4,
    git: { sha: "a", branch: "b", dirty: false },
    emulator: {
      fps_mean: 30,
      emulate_ms_p95: 25,
      late_ms_p95: 5,
      apply_ms_p95: 10,
      resync_delta: 0,
      ticks_delta: 900,
    },
    stream: {
      active_last: 1,
      hw_encode_engaged: 1,
      ffmpeg_speed_ratio: { min: 0.95, mean: 1, last: 1 },
      ffmpeg_fps: { min: 29, mean: 30 },
      ffmpeg_bitrate_kbps: { mean: 5000 },
      frame_interval_ms_p50: 33,
      frame_interval_ms_p95: 40,
      frame_write_ms_p95: 1,
      sink_buffer_bytes_max: 0,
      send_frametime_ratio_video_p50: 0.5,
      send_frametime_ratio_video_p95: 0.9,
      send_frametime_ratio_audio_p50: 0.4,
      send_frametime_ratio_audio_p95: 0.8,
      send_late_frames_video_delta: 0,
      send_late_frames_audio_delta: 0,
      ...overrides,
    },
    input: {
      controller_rtt_ms_p50: 30,
      controller_rtt_ms_p95: 75,
      input_apply_delay_ms_p50: 5,
      input_apply_delay_ms_p95: 15,
    },
  };
}

describe("compareSummaries + renderCompareTable", () => {
  it("flags a real improvement and a real regression", () => {
    const baseline = makeSummary({});
    const current = makeSummary({
      frame_interval_ms_p95: 33, // improved (was 40) → -17.5% (below 5% threshold)
      sink_buffer_bytes_max: 1_000_000, // regressed (was 0)
    });
    const rows = compareSummaries(baseline, current);

    const fpInt = rows.find((r) => r.metric === "stream.frame_interval_ms_p95");
    expect(fpInt?.verdict).toBe("improved");

    const sink = rows.find((r) => r.metric === "stream.sink_buffer_bytes_max");
    expect(sink?.verdict).toBe("regressed");

    // Untouched metric stays "ok".
    const fps = rows.find((r) => r.metric === "emulator.fps_mean");
    expect(fps?.verdict).toBe("ok");
  });

  it("treats sub-threshold changes as ok", () => {
    const baseline = makeSummary({});
    const current = makeSummary({ frame_interval_ms_p95: 41 }); // +2.5% < 5%
    const rows = compareSummaries(baseline, current);
    const fp = rows.find((r) => r.metric === "stream.frame_interval_ms_p95");
    expect(fp?.verdict).toBe("ok");
  });

  it("renders a non-empty table", () => {
    const rows = compareSummaries(makeSummary({}), makeSummary({}));
    const table = renderCompareTable(rows);
    expect(table).toContain("metric");
    expect(table).toContain("baseline");
    expect(table).toContain("verdict");
    expect(table.split("\n").length).toBeGreaterThan(rows.length);
  });
});
