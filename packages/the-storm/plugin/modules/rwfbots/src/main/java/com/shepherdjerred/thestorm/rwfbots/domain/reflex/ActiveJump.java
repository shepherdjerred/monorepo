package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;

/** One committed measured primitive, retained across planner updates and airborne combat aiming. */
public record ActiveJump(
    Waypoint waypoint, Intent intent, Stage stage, long startedTick, long launchTick) {
  public record Intent(Option option, Vec3 routeGoal) {}

  public enum Stage {
    APPROACH,
    BACKUP,
    RUN_UP,
    AIRBORNE
  }

  public ActiveJump {
    if (waypoint.hop() != Hop.LEAP || waypoint.launch().isEmpty())
      throw new IllegalArgumentException("active jump requires baked launch metadata");
    if (stage == Stage.AIRBORNE && launchTick < startedTick)
      throw new IllegalArgumentException("airborne primitive has no launch tick");
  }

  public ActiveJump stage(Stage next, long now) {
    return new ActiveJump(
        waypoint, intent, next, startedTick, next == Stage.AIRBORNE ? now : launchTick);
  }
}
