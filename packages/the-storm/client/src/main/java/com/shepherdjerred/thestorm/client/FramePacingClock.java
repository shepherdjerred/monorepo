package com.shepherdjerred.thestorm.client;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Records every real render callback in a bounded monotonic window, including stalled tail time.
 */
final class FramePacingClock {
  static final int MAX_DURATION_MS = 60_000;
  static final int MAX_FRAMES = 36_000;

  record Camera(double x, double y, double z, float yaw, float pitch) {}

  record RenderObservation(
      long worldTick, boolean focused, boolean screenOpen, int effectiveFpsCap, Camera camera) {}

  record Observation(
      int index,
      long elapsedNanos,
      long intervalNanos,
      long worldTick,
      boolean focused,
      boolean screenOpen,
      int effectiveFpsCap,
      Camera camera) {}

  record Quantiles(
      int intervals,
      double meanNanos,
      long p50Nanos,
      long p95Nanos,
      long p99Nanos,
      long maxNanos) {}

  private final long began;
  private final long duration;
  private final int target;
  private final List<Observation> observations = new ArrayList<>();
  private long previousElapsed;
  private long observedElapsed;
  private long measuredDuration;
  private String completion = "";

  FramePacingClock(long began, int durationMs, int targetFrames) {
    if (durationMs < 1
        || durationMs > MAX_DURATION_MS
        || targetFrames < 2
        || targetFrames > MAX_FRAMES)
      throw new IllegalArgumentException("Invalid frame pacing window");
    this.began = began;
    duration = durationMs * 1_000_000L;
    target = targetFrames;
  }

  void rendered(long now, RenderObservation frame) {
    if (complete()) return;
    var elapsed = elapsed(now);
    if (elapsed > duration) {
      finish(elapsed, "DURATION");
      return;
    }
    if (!observations.isEmpty() && elapsed <= previousElapsed)
      throw new IllegalArgumentException("Render clock did not advance");
    var interval = observations.isEmpty() ? 0 : elapsed - previousElapsed;
    observations.add(
        new Observation(
            observations.size(),
            elapsed,
            interval,
            frame.worldTick(),
            frame.focused(),
            frame.screenOpen(),
            frame.effectiveFpsCap(),
            frame.camera()));
    previousElapsed = elapsed;
    if (observations.size() == target) finish(elapsed, "FRAME_LIMIT");
    else if (elapsed == duration) finish(elapsed, "DURATION");
  }

  void tick(long now) {
    if (!complete() && elapsed(now) >= duration) finish(elapsed(now), "DURATION");
  }

  void interrupted(long now) {
    if (!complete()) finish(elapsed(now), "INTERRUPTED");
  }

  private long elapsed(long now) {
    var elapsed = now - began;
    if (elapsed < 0) throw new IllegalArgumentException("Frame pacing clock moved backward");
    return elapsed;
  }

  private void finish(long elapsed, String reason) {
    observedElapsed = elapsed;
    measuredDuration = Math.min(duration, elapsed);
    completion = reason;
  }

  boolean complete() {
    return !completion.isEmpty();
  }

  String completion() {
    return completion;
  }

  long observedElapsedNanos() {
    return observedElapsed;
  }

  long measuredDurationNanos() {
    return measuredDuration;
  }

  long tailNanos() {
    return measuredDuration - previousElapsed;
  }

  int frames() {
    return observations.size();
  }

  List<Observation> observations() {
    return List.copyOf(observations);
  }

  Quantiles quantiles() {
    var intervals = observations.stream().skip(1).mapToLong(Observation::intervalNanos).toArray();
    if (intervals.length == 0) throw new IllegalStateException("Fewer than two rendered frames");
    Arrays.sort(intervals);
    return new Quantiles(
        intervals.length,
        Arrays.stream(intervals).average().orElseThrow(),
        percentile(intervals, 50),
        percentile(intervals, 95),
        percentile(intervals, 99),
        intervals[intervals.length - 1]);
  }

  private static long percentile(long[] sorted, int percentile) {
    return sorted[(sorted.length * percentile + 99) / 100 - 1];
  }
}
