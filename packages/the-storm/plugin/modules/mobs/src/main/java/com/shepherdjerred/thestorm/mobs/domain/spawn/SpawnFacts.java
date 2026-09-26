package com.shepherdjerred.thestorm.mobs.domain.spawn;

import java.util.Set;

/**
 * A spawning mob, as the spawn policy sees it.
 *
 * @param type the entity type's key without namespace, such as {@code zombie}
 * @param reason the spawn reason's name, such as {@code NATURAL} or {@code SPAWNER}
 * @param traits what else is true of the mob
 */
public record SpawnFacts(String type, String reason, Set<Trait> traits) {

  public SpawnFacts {
    traits = Set.copyOf(traits);
  }

  public boolean is(Trait trait) {
    return traits.contains(trait);
  }
}
