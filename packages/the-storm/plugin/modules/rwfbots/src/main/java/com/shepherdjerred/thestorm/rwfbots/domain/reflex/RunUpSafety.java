package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;

/** Grounded sprint input stays on the actual runway until the measured jump is accepted. */
public final class RunUpSafety {
  private RunUpSafety() {}

  public static boolean permits(
      MovementSafety.Terrain terrain, JumpLaunch launch, Vec3 from, Vec3 projected) {
    var direction = launch.takeoff().minus(launch.runUpStart()).horizontal().normalized();
    var length = launch.runUpStart().horizontalDistance(launch.takeoff());
    return onRunway(from, launch.takeoff(), direction, length)
        && onRunway(projected, launch.takeoff(), direction, length)
        && MovementSafety.supportedCorridor(terrain, from, projected);
  }

  private static boolean onRunway(Vec3 feet, Vec3 takeoff, Vec3 direction, double length) {
    var offset = feet.minus(takeoff).horizontal();
    var along = offset.dot(direction);
    return along >= -length - JumpController.RUN_UP_START_REACH
        && along <= JumpController.MAX_LAUNCH_ALONG
        && offset.minus(direction.scale(along)).length() <= JumpController.MAX_CROSS_TRACK
        && Math.abs(feet.y() - takeoff.y()) <= JumpController.MAX_HEIGHT_ERROR;
  }
}
