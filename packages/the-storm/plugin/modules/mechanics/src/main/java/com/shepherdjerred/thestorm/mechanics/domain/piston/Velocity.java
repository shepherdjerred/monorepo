package com.shepherdjerred.thestorm.mechanics.domain.piston;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;

/**
 * A launch speed, in blocks per tick.
 *
 * @param x east
 * @param y up
 * @param z south
 */
public record Velocity(double x, double y, double z) {

  /** {@code speed} blocks per tick toward {@code direction}. */
  public static Velocity toward(Direction direction, double speed) {
    return new Velocity(direction.dx() * speed, direction.dy() * speed, direction.dz() * speed);
  }
}
