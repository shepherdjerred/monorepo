package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;

/**
 * A route primitive is complete only at its landing height/state, including submerged waypoints.
 */
public final class WaypointArrival {
  private WaypointArrival() {}

  public static boolean reached(CombatantView self, Waypoint waypoint) {
    var vertical = Math.abs(self.pos().y() - waypoint.pos().y());
    var horizontal = self.pos().horizontalDistance(waypoint.pos());
    if (waypoint.landing() == Waypoint.Landing.WATER) return vertical <= 0.2 && horizontal <= 0.4;
    if (waypoint.landing() == Waypoint.Landing.CLIMB) return vertical <= 0.3 && horizontal <= 0.45;
    var airbornePrimitive =
        waypoint.hop() == Hop.JUMP
            || waypoint.hop() == Hop.LEAP
            || waypoint.hop() == Hop.DROP
            || waypoint.hop() == Hop.SWIM;
    return vertical <= 0.65 && horizontal <= 0.45 && (!airbornePrimitive || self.onGround());
  }
}
