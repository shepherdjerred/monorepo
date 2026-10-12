package com.shepherdjerred.thestorm.rwfbots.app;

/** Actual observation time, or when a living bot first began waiting for its first perception. */
public record PerceptionAge(long since, boolean pending) {
  public PerceptionAge {
    if (since < 0) throw new IllegalArgumentException("perception timestamp must not be negative");
  }

  public long at(long tick) {
    if (tick < since) throw new IllegalArgumentException("perception timestamp is in the future");
    return tick - since;
  }
}
