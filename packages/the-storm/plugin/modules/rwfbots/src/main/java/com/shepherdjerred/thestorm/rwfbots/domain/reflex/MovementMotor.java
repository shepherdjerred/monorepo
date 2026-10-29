package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/** Acceleration-limited movement independent of facing; never replaces vertical motion. */
public final class MovementMotor {

  public static final double WALK_SPEED = 0.215;
  public static final double SPRINT_SPEED = 0.28;
  public static final double JUMP_SPEED = 0.42;
  private static final double SPRINT_JUMP_IMPULSE = 0.2;
  private static final double SWIM_VERTICAL_SPEED = 0.16;
  private static final double GROUND_ACCELERATION = 0.1;
  private static final double AIR_ACCELERATION = 0.02;

  private MovementMotor() {}

  public record Control(Vec3 heading, boolean sprint, boolean onGround, double slowdown) {}

  /** Steers towards a desired horizontal velocity while retaining knockback and gravity. */
  public static Vec3 steer(Vec3 velocity, Control control) {
    return steer(velocity, control, false);
  }

  /** Water needs its own drag/acceleration rather than the very weak airborne control. */
  public static Vec3 swim(Vec3 velocity, Control control) {
    return steer(velocity, control, true);
  }

  private static Vec3 steer(Vec3 velocity, Control control, boolean swimming) {
    var heading = control.heading();
    var sprint = control.sprint();
    var onGround = control.onGround();
    var slowdown = control.slowdown();
    if (!(slowdown > 0 && slowdown <= 1)) {
      throw new IllegalArgumentException("slowdown must be in (0, 1]");
    }
    var speed =
        (swimming ? (sprint ? 0.2 : 0.17) : (sprint ? SPRINT_SPEED : WALK_SPEED)) * slowdown;
    var horizontal = heading.horizontal();
    var target =
        horizontal.isZero()
            ? Vec3.ZERO
            : horizontal.normalized().scale(Math.min(speed, horizontal.length()));
    var delta = inputDelta(target.minus(velocity.horizontal()), control);
    var acceleration =
        (swimming ? 0.04 : onGround ? GROUND_ACCELERATION : AIR_ACCELERATION)
            * (sprint ? 1.3 : 1)
            * slowdown;
    var change = delta.length() > acceleration ? delta.normalized().scale(acceleration) : delta;
    return velocity.plus(change);
  }

  /** Air input can turn or oppose motion without erasing forward launch momentum. */
  private static Vec3 inputDelta(Vec3 delta, Control control) {
    var horizontal = control.heading().horizontal();
    if (control.onGround() || horizontal.isZero()) return delta;
    var direction = horizontal.normalized();
    var forward = delta.dot(direction);
    return forward < 0 ? delta.minus(direction.scale(forward)) : delta;
  }

  /** A sprint launch whose travel already runs along its heading, as a measured run-up does. */
  public static Vec3 jump(Vec3 velocity, boolean sprint) {
    return jump(velocity, sprint, velocity);
  }

  /**
   * A sprint launch boosts along the steering {@code heading}, independently of where combat aiming
   * faces and of knockback the body is still carrying: boosting along current velocity made a jump
   * right after a hit carry the body about a fifth further with the blow.
   */
  public static Vec3 jump(Vec3 velocity, boolean sprint, Vec3 heading) {
    var direction = heading.horizontal();
    var impulse =
        sprint && !direction.isZero()
            ? direction.normalized().scale(SPRINT_JUMP_IMPULSE)
            : Vec3.ZERO;
    return velocity.horizontal().plus(impulse).plus(0, JUMP_SPEED, 0);
  }

  /**
   * Directed fluid input: ascend, descend, or hold a submerged waypoint without overriding land
   * gravity.
   */
  public static double swimVertical(double heightError) {
    if (!Double.isFinite(heightError))
      throw new IllegalArgumentException("water height error must be finite");
    return Math.clamp(heightError * 0.5, -SWIM_VERTICAL_SPEED, SWIM_VERTICAL_SPEED);
  }

  public static double climbVertical(double heightError) {
    if (!Double.isFinite(heightError))
      throw new IllegalArgumentException("climb height error must be finite");
    // A ledge collision requires clearing its exact height, rather than approaching from below.
    return heightError > 0
        ? Math.clamp(heightError * 0.5, 0.08, 0.2)
        : Math.clamp(heightError * 0.5, -0.15, 0);
  }
}
