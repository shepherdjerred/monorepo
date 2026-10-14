package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/** Surface swimming and an explicit bank-exit stroke, including while holding a position. */
public final class SwimmingMotion {
  private static final double SURFACE_DEPTH = 0.4;
  private static final double ASCEND = 0.16;
  private static final double DESCEND = -0.04;
  private static final double BANK_STROKE = 0.3;

  private SwimmingMotion() {}

  /** Preserves upward impulses but arrests sinking even when the current waypoint is level. */
  public static Vec3 buoyancy(Vec3 velocity, double feetY, double surfaceY, boolean leavingWater) {
    var stroke =
        leavingWater
            ? BANK_STROKE
            : Math.clamp((surfaceY - SURFACE_DEPTH - feetY) * 0.35, DESCEND, ASCEND);
    return velocity.withY(Math.max(velocity.y(), stroke));
  }

  /** Directed submerged routes may descend or hold depth; large upward impulses still survive. */
  public static Vec3 directed(Vec3 velocity, double heightError, boolean leavingWater) {
    if (leavingWater) return velocity.withY(Math.max(velocity.y(), BANK_STROKE));
    var stroke = MovementMotor.swimVertical(heightError);
    return velocity.withY(velocity.y() > ASCEND ? velocity.y() : stroke);
  }
}
