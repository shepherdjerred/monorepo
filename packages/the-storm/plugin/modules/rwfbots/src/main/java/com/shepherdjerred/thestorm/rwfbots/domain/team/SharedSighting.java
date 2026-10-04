package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;

/**
 * An enemy sighting one teammate reported to the others.
 *
 * @param enemy who was seen
 * @param pos where
 * @param vel moving how
 * @param seenTick when it was seen
 * @param visibleAtTick when teammates get to hear about it
 * @param reporter who saw it
 */
public record SharedSighting(
    CombatantId enemy,
    Vec3 pos,
    Vec3 vel,
    long seenTick,
    long visibleAtTick,
    CombatantId reporter) {

  public SharedSighting {
    if (seenTick < 0 || visibleAtTick < seenTick) {
      throw new IllegalArgumentException("a sighting is shared at or after it is seen");
    }
  }
}
