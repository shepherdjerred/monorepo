package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.HitWindow;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.entity.LivingEntity;

/**
 * What the combat listener remembers between hits: the damage that opened each victim's hit window
 * and who dealt it, so deaths can be attributed and the window compared against our own numbers
 * rather than the server's. Main thread only.
 */
final class CombatTracker {

  /**
   * The last hit on a victim.
   *
   * @param damage what landed
   * @param attacker who, when a combatant
   * @param cause how
   */
  record Last(double damage, Optional<UUID> attacker, AttackType cause) {}

  private final Map<UUID, Last> last = new HashMap<>();

  /** The victim's invulnerability state as the rules see it. */
  HitWindow.Guard guard(LivingEntity victim) {
    var previous = last.get(victim.getUniqueId());
    return new HitWindow.Guard(
        Math.max(0, victim.getNoDamageTicks()), previous == null ? 0 : previous.damage());
  }

  /** A hit landed in full: a fresh window opens at {@code damage}. */
  void hit(LivingEntity victim, double damage, Optional<UUID> attacker, AttackType cause) {
    last.put(victim.getUniqueId(), new Last(damage, attacker, cause));
  }

  /** The victim was hurt by the world (fall, fire, the poison): remember the cause only. */
  void hurt(UUID victim, AttackType cause) {
    var previous = last.get(victim);
    last.put(victim, new Last(previous == null ? 0 : previous.damage(), Optional.empty(), cause));
  }

  Optional<Last> last(UUID victim) {
    return Optional.ofNullable(last.get(victim));
  }

  void forget(UUID victim) {
    last.remove(victim);
  }

  void clear() {
    last.clear();
  }
}
