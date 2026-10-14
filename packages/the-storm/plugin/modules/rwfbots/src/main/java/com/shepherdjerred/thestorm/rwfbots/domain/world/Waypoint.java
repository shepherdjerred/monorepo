package com.shepherdjerred.thestorm.rwfbots.domain.world;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.Optional;

/** One point on a path and how to get onto it. */
public record Waypoint(Vec3 pos, Hop hop, Optional<JumpLaunch> launch, Landing landing) {
  public enum Landing {
    GROUND,
    WATER,
    CLIMB
  }

  public Waypoint(Vec3 pos, Hop hop) {
    this(pos, hop, Optional.empty(), defaultLanding(hop));
  }

  public Waypoint(Vec3 pos, Hop hop, Optional<JumpLaunch> launch) {
    this(pos, hop, launch, defaultLanding(hop));
  }

  public Waypoint {
    if (hop == Hop.LEAP && launch.isEmpty())
      throw new IllegalArgumentException("sprint jump requires baked launch preconditions");
    if (launch.isPresent() && hop != Hop.LEAP)
      throw new IllegalArgumentException("only sprint jumps carry launch preconditions");
  }

  private static Landing defaultLanding(Hop hop) {
    return hop == Hop.SWIM ? Landing.WATER : hop == Hop.CLIMB ? Landing.CLIMB : Landing.GROUND;
  }
}
