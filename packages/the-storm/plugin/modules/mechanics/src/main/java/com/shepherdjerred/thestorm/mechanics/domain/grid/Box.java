package com.shepherdjerred.thestorm.mechanics.domain.grid;

import java.util.ArrayList;
import java.util.List;

/** Cubes of positions. */
public final class Box {

  private Box() {}

  /** Every position within {@code radius} of {@code center} on each axis, center included. */
  public static List<Pos> around(Pos center, int radius) {
    if (radius < 0) {
      throw new IllegalArgumentException("radius must not be negative: " + radius);
    }
    var side = 2 * radius + 1;
    var positions = new ArrayList<Pos>(side * side * side);
    for (var dx = -radius; dx <= radius; dx++) {
      for (var dy = -radius; dy <= radius; dy++) {
        for (var dz = -radius; dz <= radius; dz++) {
          positions.add(center.offset(dx, dy, dz));
        }
      }
    }
    return positions;
  }
}
