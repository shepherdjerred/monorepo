package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.tactics.FallRisk;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;

/** Rechecks survival at the physical boundary, including unplanned airborne movement. */
public final class FinalLandingRisk {
  private static final int MAX_FLIGHT_TICKS = 1_600;

  private FinalLandingRisk() {}

  /** Height is relative to the actual destination; velocity includes existing native impulses. */
  public record Descent(
      double height, double verticalSpeed, Waypoint.Landing landing, long minimumTicks) {
    public Descent {
      if (!Double.isFinite(height) || !Double.isFinite(verticalSpeed) || minimumTicks < 0)
        throw new IllegalArgumentException(
            "Landing forecast must be finite with nonnegative duration");
    }
  }

  public static boolean permits(
      Descent descent, TraversalState survival, double effectiveHealth, long now) {
    if (!Double.isFinite(effectiveHealth) || effectiveHealth <= 0)
      throw new IllegalArgumentException(
          "A moving body must have positive finite effective health");
    var height = descent.height();
    var speed = descent.verticalSpeed();
    var fallen = 0.0;
    for (var elapsed = 1; elapsed <= MAX_FLIGHT_TICKS; elapsed++) {
      height += speed;
      fallen += Math.max(0, -speed);
      var arrival = now + Math.max(elapsed, descent.minimumTicks()) + 2;
      if (height <= 0 && speed <= 0) {
        var damage =
            FallRisk.landingDamage(
                Math.max(0, fallen + height), descent.landing(), survival, arrival);
        return damage == 0 || damage <= effectiveHealth - 1;
      }
      var gravity =
          speed <= 0 && FallRisk.active(survival.slowFallingUntilTick(), now + elapsed)
              ? 0.01
              : 0.08;
      speed = (speed - gravity) * 0.98;
    }
    return false;
  }
}
