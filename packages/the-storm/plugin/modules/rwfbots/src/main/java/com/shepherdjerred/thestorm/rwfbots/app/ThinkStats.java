package com.shepherdjerred.thestorm.rwfbots.app;

import java.util.Arrays;

/**
 * A small ring of recent durations with a percentile, for the governor and the debug command. Safe
 * to record from one thread and read from another.
 */
public final class ThinkStats {

  /** How many recent samples are kept. */
  public static final int WINDOW = 64;

  private final long[] samples = new long[WINDOW];
  private int count;
  private int next;
  private long last;

  /** Records one duration in nanoseconds. */
  public synchronized void record(long nanos) {
    samples[next] = nanos;
    next = (next + 1) % WINDOW;
    count = Math.min(WINDOW, count + 1);
    last = nanos;
  }

  /** The last duration, in milliseconds. */
  public synchronized double lastMillis() {
    return last / 1_000_000.0;
  }

  /** The {@code percentile} (0..1) of the recent durations, in milliseconds; 0 before any. */
  public synchronized double percentileMillis(double percentile) {
    if (count == 0) {
      return 0;
    }
    var sorted = Arrays.copyOf(samples, count);
    Arrays.sort(sorted);
    var index = (int) Math.ceil(percentile * count) - 1;
    return sorted[Math.clamp(index, 0, count - 1)] / 1_000_000.0;
  }

  public synchronized int count() {
    return count;
  }
}
