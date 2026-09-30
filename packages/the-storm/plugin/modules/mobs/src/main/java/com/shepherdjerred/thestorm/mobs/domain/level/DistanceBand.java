package com.shepherdjerred.thestorm.mobs.domain.level;

/**
 * A ring around the world spawn. A mob spawning at least {@code from} blocks away (and closer than
 * the next band) starts at a level drawn evenly from {@code min} to {@code max}.
 *
 * @param from the inner edge of the ring, in blocks from the world spawn
 * @param min the lowest starting level in this ring
 * @param max the highest starting level in this ring
 */
public record DistanceBand(int from, int min, int max) {

  public DistanceBand {
    if (from < 0) {
      throw new IllegalArgumentException("from must not be negative: " + from);
    }
    if (min < 1 || max < min) {
      throw new IllegalArgumentException("need 1 <= min <= max, got " + min + ".." + max);
    }
  }
}
