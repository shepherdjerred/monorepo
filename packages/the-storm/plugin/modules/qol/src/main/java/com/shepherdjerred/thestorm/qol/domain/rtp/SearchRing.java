package com.shepherdjerred.thestorm.qol.domain.rtp;

import java.util.List;
import java.util.Optional;

/**
 * An annulus of block distances from spawn: past the farthest claim, and short of the world border.
 *
 * @param inner the nearest a landing may be
 * @param outer the farthest a landing may be
 */
public record SearchRing(int inner, int outer) {

  public SearchRing {
    if (inner < 0 || outer <= inner) {
      throw new IllegalArgumentException("ring " + inner + ".." + outer);
    }
  }

  /**
   * The ring starting {@code gap} blocks past {@code farthest} and extending {@code band} further,
   * clamped to {@code maxRadius}. Empty when the border leaves no room.
   */
  public static Optional<SearchRing> around(int farthest, int gap, int band, int maxRadius) {
    if (farthest < 0 || gap < 0 || band <= 0 || maxRadius < 0) {
      throw new IllegalArgumentException("negative search bound");
    }
    var inner = farthest + gap;
    var outer = Math.min(inner + band, maxRadius);
    if (outer <= inner) {
      return Optional.empty();
    }
    return Optional.of(new SearchRing(inner, outer));
  }

  /** Distance from spawn to the farthest of {@code points}, or 0 when there are none. */
  public static int farthest(BlockPoint spawn, List<BlockPoint> points) {
    var max = 0;
    for (var point : points) {
      max = Math.max(max, spawn.distanceTo(point));
    }
    return max;
  }
}
