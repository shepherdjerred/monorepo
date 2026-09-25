package com.shepherdjerred.thestorm.spells.domain.geometry;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** The block layouts spells work on. Every method returns positions in a stable order. */
public final class Shapes {

  private Shapes() {}

  /**
   * A wall {@code width} wide and {@code height} tall standing on {@code base}, running across the
   * caster's {@code facing} so it blocks the way they look.
   */
  public static List<BlockPos> wall(BlockPos base, Facing facing, int width, int height) {
    requirePositive("width", width);
    requirePositive("height", height);
    var across = facing.left();
    var firstOffset = -(width - 1) / 2;
    var positions = new ArrayList<BlockPos>();
    for (var up = 0; up < height; up++) {
      for (var step = 0; step < width; step++) {
        var along = firstOffset + step;
        positions.add(base.offset(across.dx() * along, up, across.dz() * along));
      }
    }
    return positions;
  }

  /**
   * A tomb around a creature {@code height} blocks tall standing at {@code feet}: its four sides at
   * every level, a roof above its head and a floor under its feet.
   */
  public static List<BlockPos> tomb(BlockPos feet, int height) {
    requirePositive("height", height);
    var positions = new ArrayList<BlockPos>();
    positions.add(feet.below());
    for (var up = 0; up < height; up++) {
      for (var side : Facing.values()) {
        positions.add(feet.offset(side.dx(), up, side.dz()));
      }
    }
    positions.add(feet.offset(0, height, 0));
    return positions;
  }

  /** A square platform {@code size} blocks across (odd), centred on {@code centre}. */
  public static List<BlockPos> platform(BlockPos centre, int size) {
    if (size < 1 || size % 2 == 0) {
      throw new IllegalArgumentException("a platform needs an odd, positive size: " + size);
    }
    var half = size / 2;
    var positions = new ArrayList<BlockPos>();
    for (var dx = -half; dx <= half; dx++) {
      for (var dz = -half; dz <= half; dz++) {
        positions.add(centre.offset(dx, 0, dz));
      }
    }
    return positions;
  }

  /** Every position within {@code radius} of {@code centre} (a ball), nearest first. */
  public static List<BlockPos> ball(BlockPos centre, int radius) {
    return cylinder(centre, radius, radius, radius).stream()
        .filter(pos -> pos.distanceSquared(centre) <= radius * radius)
        .toList();
  }

  /**
   * Every position within horizontal {@code radius} of {@code centre}, from {@code down} blocks
   * below to {@code up} blocks above, nearest first.
   */
  public static List<BlockPos> cylinder(BlockPos centre, int radius, int down, int up) {
    if (radius < 0 || down < 0 || up < 0) {
      throw new IllegalArgumentException("a cylinder needs non-negative extents");
    }
    var positions = new ArrayList<BlockPos>();
    for (var dy = -down; dy <= up; dy++) {
      for (var dx = -radius; dx <= radius; dx++) {
        for (var dz = -radius; dz <= radius; dz++) {
          if (dx * dx + dz * dz <= radius * radius) {
            positions.add(centre.offset(dx, dy, dz));
          }
        }
      }
    }
    positions.sort(
        Comparator.comparingInt((BlockPos pos) -> pos.distanceSquared(centre))
            .thenComparingInt(BlockPos::y)
            .thenComparingInt(BlockPos::x)
            .thenComparingInt(BlockPos::z));
    return positions;
  }

  private static void requirePositive(String name, int value) {
    if (value < 1) {
      throw new IllegalArgumentException(name + " must be positive: " + value);
    }
  }
}
