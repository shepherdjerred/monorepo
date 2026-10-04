package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import java.util.HashSet;
import java.util.Set;

/**
 * Which apparent teammates this bot has caught out as spies. A spy counts as an ally until it hits
 * one of ours or touches our bomb; after that it is an enemy for the rest of its life.
 *
 * @param revealed the combatants known to be disguised enemies
 */
public record Suspicion(Set<CombatantId> revealed) {

  public static final Suspicion NONE = new Suspicion(Set.of());

  public Suspicion {
    revealed = Set.copyOf(revealed);
  }

  public boolean isRevealed(CombatantId id) {
    return revealed.contains(id);
  }

  public Suspicion reveal(CombatantId id) {
    if (revealed.contains(id)) {
      return this;
    }
    var copy = new HashSet<>(revealed);
    copy.add(id);
    return new Suspicion(copy);
  }
}
