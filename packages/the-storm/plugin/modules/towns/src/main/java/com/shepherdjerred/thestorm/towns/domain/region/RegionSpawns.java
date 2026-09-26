package com.shepherdjerred.thestorm.towns.domain.region;

import java.util.Set;
import java.util.regex.Pattern;

/**
 * Which creature spawns an admin region lets through. A region that limits spawns lets only the
 * listed spawn reasons spawn creatures inside it; the arena, for example, lets only the waves the
 * arena module spawns ({@code CUSTOM}) and staff summons ({@code COMMAND}) in, so nothing wanders
 * into a fight.
 *
 * @param limited true when only {@code allow} may spawn creatures here; false lets every spawn
 * @param allow the spawn reasons (Paper's {@code CreatureSpawnEvent.SpawnReason} names) let through
 *     when limited; must be empty when not
 */
public record RegionSpawns(boolean limited, Set<String> allow) {

  private static final Pattern REASON = Pattern.compile("[A-Z][A-Z0-9_]*");

  public RegionSpawns {
    allow = Set.copyOf(allow);
    if (!limited && !allow.isEmpty()) {
      throw new IllegalArgumentException("allow only means something when limited is true");
    }
    for (var reason : allow) {
      if (!REASON.matcher(reason).matches()) {
        throw new IllegalArgumentException("not a spawn reason name: " + reason);
      }
    }
  }

  /** Every spawn allowed. */
  public static RegionSpawns unlimited() {
    return new RegionSpawns(false, Set.of());
  }

  /** True when a creature spawning for {@code reason} may spawn inside the region. */
  public boolean allows(String reason) {
    return !limited || allow.contains(reason);
  }
}
