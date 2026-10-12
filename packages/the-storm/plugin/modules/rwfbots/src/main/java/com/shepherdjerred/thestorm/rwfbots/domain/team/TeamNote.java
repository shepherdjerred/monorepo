package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import java.util.Optional;
import java.util.Set;

/**
 * What one bot tells its team after thinking, so teammates do not share its cover, pile onto its
 * target or walk its path.
 *
 * @param cover the cover node it holds or is moving to
 * @param chasing the enemy it is fighting
 * @param path the nav nodes it is about to walk
 */
public record TeamNote(Optional<Integer> cover, Optional<CombatantId> chasing, Set<Integer> path) {

  public static final TeamNote NONE = new TeamNote(Optional.empty(), Optional.empty(), Set.of());

  public TeamNote {
    path = Set.copyOf(path);
  }
}
