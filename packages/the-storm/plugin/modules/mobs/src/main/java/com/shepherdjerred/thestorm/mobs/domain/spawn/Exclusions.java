package com.shepherdjerred.thestorm.mobs.domain.spawn;

import java.util.Locale;
import java.util.Set;

/**
 * Which hostile mobs may be levelled.
 *
 * @param types entity type keys without namespace, such as {@code warden}, that are never levelled
 * @param levelledReasons the only spawn reason names, such as {@code NATURAL}, whose mobs are
 *     levelled. An allowlist: spawners, eggs, raids, slime splits, portals, reinforcements and any
 *     reason a future version adds stay vanilla, so no farm can breed levelled mobs
 * @param babies whether baby mobs are left alone (fast baby zombies with a level were too much in
 *     2023)
 */
public record Exclusions(Set<String> types, Set<String> levelledReasons, boolean babies) {

  public Exclusions {
    types = Set.copyOf(types);
    levelledReasons = Set.copyOf(levelledReasons);
    for (var type : types) {
      if (type.isBlank() || !type.equals(type.toLowerCase(Locale.ROOT))) {
        throw new IllegalArgumentException("mob types are lowercase keys: '" + type + "'");
      }
    }
    if (levelledReasons.isEmpty()) {
      throw new IllegalArgumentException("levelledReasons must name at least one spawn reason");
    }
    for (var reason : levelledReasons) {
      if (reason.isBlank() || !reason.equals(reason.toUpperCase(Locale.ROOT))) {
        throw new IllegalArgumentException("spawn reasons are uppercase names: '" + reason + "'");
      }
    }
  }
}
