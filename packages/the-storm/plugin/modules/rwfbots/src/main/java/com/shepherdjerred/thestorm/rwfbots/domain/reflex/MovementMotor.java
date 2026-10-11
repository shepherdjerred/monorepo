package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/** Acceleration-limited movement independent of facing; never replaces vertical motion. */
public final class MovementMotor {

  public static final double WALK_SPEED = 0.215;
  public static final double SPRINT_SPEED = 0.28;
  private static final double GROUND_ACCELERATION = 0.1;
  private static final double AIR_ACCELERATION = 0.02;

  private MovementMotor() {}

  public record Control(Vec3 heading, boolean sprint, boolean onGround, double slowdown) {}

  /** Steers towards a desired horizontal velocity while retaining knockback and gravity. */
  public static Vec3 steer(Vec3 velocity, Control control) {
    var heading = control.heading();
    var sprint = control.sprint();
    var onGround = control.onGround();
    var slowdown = control.slowdown();
    if (!(slowdown > 0 && slowdown <= 1)) {
      throw new IllegalArgumentException("slowdown must be in (0, 1]");
    }
    var speed = (sprint ? SPRINT_SPEED : WALK_SPEED) * slowdown;
    var horizontal = heading.horizontal();
    var target = horizontal.isZero() ? Vec3.ZERO : horizontal.normalized().scale(speed);
    var delta = target.minus(velocity.horizontal());
    var acceleration =
        (onGround ? GROUND_ACCELERATION : AIR_ACCELERATION) * (sprint ? 1.3 : 1) * slowdown;
    var change = delta.length() > acceleration ? delta.normalized().scale(acceleration) : delta;
    return velocity.plus(change);
  }
}
