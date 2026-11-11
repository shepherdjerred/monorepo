package com.shepherdjerred.thestorm.rwfbots.domain.world;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;

/**
 * A supply crate that has landed. Loot rights follow {@code Delivery.mayLoot}: the owner at once,
 * their team after 30 seconds, anyone after a minute.
 *
 * @param pos the block center of the chest
 * @param owner who called it in
 * @param team the owner's team when it landed
 * @param landedTick the match tick it landed
 */
public record CrateView(Vec3 pos, CombatantId owner, TeamId team, long landedTick) {

  public CrateView {
    if (landedTick < 0) {
      throw new IllegalArgumentException("landed tick must not be negative: " + landedTick);
    }
  }
}
