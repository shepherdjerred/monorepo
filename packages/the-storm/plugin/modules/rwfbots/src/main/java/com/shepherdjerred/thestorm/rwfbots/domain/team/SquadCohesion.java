package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import java.util.Map;

/**
 * A soft shared-route preference; roles, reachability and individual personalities still matter.
 */
final class SquadCohesion {
  // A shared route may justify four blocks of extra travel, never a march across the whole yard.
  private static final double ROUTE_BONUS =
      TeamBrain.DISTANCE_WEIGHT
          * com.shepherdjerred.thestorm.rwfbots.domain.map.TraversalCosts.walkingTicks(4)
          / TeamBrain.DISTANCE_SCALE;

  private SquadCohesion() {}

  static double fit(Map<CombatantId, Integer> groups, CombatantId bot, Slot slot, int lanes) {
    var group = groups.getOrDefault(bot, -1);
    if (group < 0 || slot.lane() < 0 || lanes < 2) return 0;
    return slot.lane() == group % lanes ? ROUTE_BONUS : 0;
  }
}
