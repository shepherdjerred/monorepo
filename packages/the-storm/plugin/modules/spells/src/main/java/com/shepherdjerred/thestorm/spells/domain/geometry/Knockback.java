package com.shepherdjerred.thestorm.spells.domain.geometry;

/** Velocities for pushes, launches and leaps. */
public final class Knockback {

  private Knockback() {}

  /**
   * A push away from {@code from}: {@code strength} blocks per tick horizontally plus {@code lift}
   * upward. A target standing exactly on {@code from} is only lifted.
   */
  public static Vec3 away(Vec3 from, Vec3 target, double strength, double lift) {
    var direction = target.minus(from).horizontal().normalized();
    return direction.times(strength).plus(Vec3.UP.times(lift));
  }

  /** A leap the way the caster looks: {@code forward} along their heading, {@code upward} up. */
  public static Vec3 leap(float yaw, double forward, double upward) {
    var heading = Vec3.facing(yaw, 0).horizontal().normalized();
    return heading.times(forward).plus(Vec3.UP.times(upward));
  }

  /**
   * Where to stand to be {@code distance} blocks behind a creature at {@code position} facing
   * {@code yaw}.
   */
  public static Vec3 behind(Vec3 position, float yaw, double distance) {
    var heading = Vec3.facing(yaw, 0).horizontal().normalized();
    return position.minus(heading.times(distance));
  }
}
