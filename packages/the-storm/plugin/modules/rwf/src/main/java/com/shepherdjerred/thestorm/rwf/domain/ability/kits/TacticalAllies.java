package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.List;

/** Support items affect living teammates in their radius, excluding their owner. */
final class TacticalAllies {
  private TacticalAllies() {}

  static List<Fighter> nearby(Fighter self, Vec3 at, double radius, Arena arena) {
    return arena.allies(self).stream()
        .filter(ally -> !ally.id().equals(self.id()))
        .filter(
            ally -> arena.position(ally.id()).filter(p -> p.distanceTo(at) <= radius).isPresent())
        .toList();
  }
}
