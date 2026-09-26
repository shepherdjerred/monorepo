package com.shepherdjerred.thestorm.mobs.domain.spawn;

import java.util.Locale;
import java.util.Set;

/**
 * Hostile mobs that are never levelled.
 *
 * @param types entity type keys without namespace, such as {@code warden}
 * @param spawnReasons spawn reason names, such as {@code SPAWNER}; mob farms built on spawners stay
 *     vanilla, as in 2023
 * @param babies whether baby mobs are left alone (fast baby zombies with a level were too much in
 *     2023)
 */
public record Exclusions(Set<String> types, Set<String> spawnReasons, boolean babies) {

  public Exclusions {
    types = Set.copyOf(types);
    spawnReasons = Set.copyOf(spawnReasons);
    for (var type : types) {
      if (type.isBlank() || !type.equals(type.toLowerCase(Locale.ROOT))) {
        throw new IllegalArgumentException("mob types are lowercase keys: '" + type + "'");
      }
    }
    for (var reason : spawnReasons) {
      if (reason.isBlank() || !reason.equals(reason.toUpperCase(Locale.ROOT))) {
        throw new IllegalArgumentException("spawn reasons are uppercase names: '" + reason + "'");
      }
    }
  }
}
