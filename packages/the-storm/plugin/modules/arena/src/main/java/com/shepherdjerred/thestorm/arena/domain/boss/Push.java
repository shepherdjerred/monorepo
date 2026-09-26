package com.shepherdjerred.thestorm.arena.domain.boss;

import com.shepherdjerred.thestorm.arena.domain.geometry.Point;

/**
 * A velocity to apply to a knocked-back fighter, in blocks per tick.
 *
 * @param x east-west
 * @param y upward
 * @param z north-south
 */
public record Push(double x, double y, double z) {

  /** Below this horizontal distance a fighter is treated as standing on the boss. */
  private static final double TOO_CLOSE = 0.01;

  /** The most upward speed a slam gives, so nobody is launched out of the arena. */
  static final double MAX_LIFT = 1.0;

  /**
   * Knocks a fighter at {@code target} away from {@code origin}: horizontally at {@code strength},
   * with a lift that grows with strength. A fighter directly on top is only lifted.
   */
  public static Push away(Point origin, Point target, double strength) {
    if (strength < 0) {
      throw new IllegalArgumentException("strength must not be negative: " + strength);
    }
    var lift = Math.min(MAX_LIFT, 0.35 + strength * 0.2);
    var dx = target.x() - origin.x();
    var dz = target.z() - origin.z();
    var horizontal = Math.sqrt(dx * dx + dz * dz);
    if (horizontal < TOO_CLOSE) {
      return new Push(0, lift, 0);
    }
    return new Push(dx / horizontal * strength, lift, dz / horizontal * strength);
  }
}
