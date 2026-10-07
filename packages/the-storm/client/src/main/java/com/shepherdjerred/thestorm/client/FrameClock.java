package com.shepherdjerred.thestorm.client;

/** Samples actual rendered frames; a missed slot fails instead of duplicating a live frame. */
final class FrameClock {
  static final int FPS = 30;
  static final long SECOND = 1_000_000_000L;
  private final int total;
  private long started;
  private int frames;

  FrameClock(int total) {
    if (total < 1 || total > 1800) throw new IllegalArgumentException("Invalid frame count");
    this.total = total;
  }

  long elapsed(long now) {
    return now - started;
  }

  int frames() {
    return frames;
  }

  boolean complete() {
    return frames == total;
  }

  boolean sample(long now) {
    if (complete()) return false;
    if (frames == 0) started = now;
    var elapsed = elapsed(now);
    var due = frames * SECOND / FPS;
    if (elapsed < due) return false;
    if (elapsed >= (frames + 1L) * SECOND / FPS) {
      throw new IllegalStateException("Rendered capture missed frame " + frames);
    }
    frames++;
    return true;
  }
}
