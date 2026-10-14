package com.shepherdjerred.thestorm.rwfbots.domain.world;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/**
 * A baked sprint-jump launch and its measured prerequisite; aiming does not set travel direction.
 */
public record JumpLaunch(Vec3 takeoff, Vec3 runUpStart, double minimumSpeed, double durationTicks) {
  public JumpLaunch {
    if (!Double.isFinite(minimumSpeed) || minimumSpeed <= 0)
      throw new IllegalArgumentException("jump launch speed must be positive and finite");
    if (takeoff.horizontalDistance(runUpStart) < 0.5)
      throw new IllegalArgumentException("sprint jump requires a real run-up");
    if (!Double.isFinite(durationTicks) || durationTicks <= 0)
      throw new IllegalArgumentException("sprint jump duration must be positive and finite");
  }
}
