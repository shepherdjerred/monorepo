package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.Map;
import java.util.Optional;

/**
 * A death, as abilities see it.
 *
 * @param victim who died
 * @param killer who killed them, if anyone
 * @param assists who else hurt them recently, with their share of the damage
 * @param cause how
 * @param at where they fell, when known
 */
public record Death(
    CombatantId victim,
    Optional<CombatantId> killer,
    Map<CombatantId, Double> assists,
    AttackType cause,
    Optional<Vec3> at) {

  public Death {
    assists = Map.copyOf(assists);
  }
}
