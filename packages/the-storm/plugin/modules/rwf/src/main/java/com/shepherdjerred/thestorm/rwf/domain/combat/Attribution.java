// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/events/DeathEvent.java and
// redwarfare-arcade/src/me/libraryaddict/arcade/game/Game.java, onKillstreakDeath); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.combat;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;

/**
 * Who a death is credited to and how it happened.
 *
 * @param killer who gets the kill, if anyone
 * @param assists everyone else who hurt the victim, with their share of the damage (0 to 1)
 * @param cause how the victim died
 * @param weapon the killer's weapon material, such as {@code IRON_SWORD}, if known
 * @param distance how far the killer stood from the victim, in blocks, if known
 */
public record Attribution(
    Optional<CombatantId> killer,
    Map<CombatantId, Double> assists,
    AttackType cause,
    Optional<String> weapon,
    OptionalDouble distance) {

  public Attribution {
    for (var share : assists.values()) {
      if (!(share > 0 && share <= 1)) {
        throw new IllegalArgumentException("an assist share is in (0, 1]: " + share);
      }
    }
    if (killer.isPresent() && assists.containsKey(killer.orElseThrow())) {
      throw new IllegalArgumentException("the killer is not also an assist");
    }
    assists = Collections.unmodifiableMap(new LinkedHashMap<>(assists));
    if (distance.isPresent() && !(distance.getAsDouble() >= 0)) {
      throw new IllegalArgumentException("distance must not be negative");
    }
  }

  /** A death with no assists worked out yet. */
  public static Attribution of(Optional<CombatantId> killer, AttackType cause) {
    return new Attribution(killer, Map.of(), cause, Optional.empty(), OptionalDouble.empty());
  }

  public Attribution withKiller(Optional<CombatantId> newKiller) {
    return new Attribution(newKiller, assists, cause, weapon, distance);
  }

  public Attribution withAssists(Map<CombatantId, Double> newAssists) {
    return new Attribution(killer, newAssists, cause, weapon, distance);
  }
}
