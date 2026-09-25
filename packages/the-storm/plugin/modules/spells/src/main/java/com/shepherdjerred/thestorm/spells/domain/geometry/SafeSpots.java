package com.shepherdjerred.thestorm.spells.domain.geometry;

import java.util.Comparator;
import java.util.Optional;

/**
 * Where a teleported player can arrive: solid, harmless ground under their feet and open, harmless
 * space for their feet and head. No spell teleports anywhere else.
 */
public final class SafeSpots {

  private SafeSpots() {}

  /** True when a player may stand with their feet in {@code feet}. */
  public static boolean isSafe(BlockProbe probe, BlockPos feet) {
    return probe.at(feet.below()) == Footing.SOLID
        && probe.at(feet) == Footing.OPEN
        && probe.at(feet.above()) == Footing.OPEN;
  }

  /**
   * The safe spot nearest {@code origin} within {@code radius} blocks (a ball), or empty. Ties go
   * to the higher spot, so a destination inside the ground resolves to its surface rather than a
   * cave below it.
   */
  public static Optional<BlockPos> nearest(BlockProbe probe, BlockPos origin, int radius) {
    if (radius < 0) {
      throw new IllegalArgumentException("radius cannot be negative: " + radius);
    }
    return Shapes.ball(origin, radius).stream()
        .sorted(
            Comparator.comparingInt((BlockPos pos) -> pos.distanceSquared(origin))
                .thenComparing(Comparator.comparingInt(BlockPos::y).reversed())
                .thenComparingInt(BlockPos::x)
                .thenComparingInt(BlockPos::z))
        .filter(pos -> isSafe(probe, pos))
        .findFirst();
  }
}
