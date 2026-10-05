package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/**
 * Where an enemy was last known to be.
 *
 * @param pos the position, blurred when heard rather than seen
 * @param vel the velocity per tick at the time, zero when unknown
 * @param tick when
 * @param confidence how sure the bot was at that tick, 0..1
 * @param direct whether it was seen rather than heard or reported
 */
public record Sighting(Vec3 pos, Vec3 vel, long tick, double confidence, boolean direct) {

  public Sighting {
    if (!(confidence >= 0 && confidence <= 1)) {
      throw new IllegalArgumentException("confidence must be 0..1: " + confidence);
    }
    if (tick < 0) {
      throw new IllegalArgumentException("tick must not be negative");
    }
  }

  /** The confidence decayed to {@code now} with time constant {@code tauTicks}. */
  public double confidenceAt(long now, double tauTicks) {
    var dt = Math.max(0, now - tick);
    // Decayed confidence feeds replayed utility scores; keep it identical on every CPU.
    return confidence * StrictMath.exp(-dt / tauTicks);
  }

  /** Where the enemy would be at {@code now} if it kept its velocity, capped at two seconds. */
  public Vec3 predictedPos(long now) {
    var dt = Math.clamp(now - tick, 0, 40);
    return pos.plus(vel.scale(dt));
  }
}
