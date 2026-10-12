package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.HitWindow;
import java.time.Instant;
import java.time.InstantSource;
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

  /**
   * The last member to hurt a victim, kept through later hurts from the world, for the deaths the
   * rules deal (see {@link com.shepherdjerred.thestorm.rwf.domain.combat.KillCredit}).
   *
   * @param attacker who
   * @param at when
   */
  record Credit(UUID attacker, Instant at) {}

  private final InstantSource time;
  private final Map<UUID, Last> last = new HashMap<>();
  private final Map<UUID, Credit> credits = new HashMap<>();

  CombatTracker(InstantSource time) {
    this.time = time;
  }

  /** The victim's invulnerability state as the rules see it. */
  HitWindow.Guard guard(LivingEntity victim) {
    var previous = last.get(victim.getUniqueId());
    return new HitWindow.Guard(
        Math.max(0, victim.getNoDamageTicks()), previous == null ? 0 : previous.damage());
  }

  /** A hit landed in full: a fresh window opens at {@code damage}. */
  void hit(LivingEntity victim, double damage, Optional<UUID> attacker, AttackType cause) {
    last.put(victim.getUniqueId(), new Last(damage, attacker, cause));
    attacker.ifPresent(who -> credits.put(victim.getUniqueId(), new Credit(who, time.instant())));
  }

  /** The last member to hurt {@code victim}, if any did since they joined the fight. */
  Optional<Credit> credit(UUID victim) {
    return Optional.ofNullable(credits.get(victim));
  }

  /** The victim was hurt by the world (fall, fire, the poison): remember the cause only. */
  void hurt(UUID victim, AttackType cause) {
    var previous = last.get(victim);
    last.put(victim, new Last(previous == null ? 0 : previous.damage(), Optional.empty(), cause));
  }

  /**
   * The victim fell into the void: credited to the attacker who last hit them, shot or pushed, if
   * any (see {@link AttackType#intoVoid}).
   */
  void intoVoid(UUID victim) {
    var previous = Optional.ofNullable(last.get(victim));
    var attacker = previous.flatMap(Last::attacker);
    var cause =
        AttackType.intoVoid(previous.filter(hit -> hit.attacker().isPresent()).map(Last::cause));
    last.put(victim, new Last(previous.map(Last::damage).orElse(0.0), attacker, cause));
  }

  /**
   * The victim stepped out of reach of whoever last hit them (the Time Machine): a later fall or
   * void is no longer theirs. The hit window, and the credit for a kill the rules deal, are kept.
   */
  void clearFallCredit(UUID victim) {
    var previous = last.get(victim);
    if (previous != null) {
      last.put(victim, new Last(previous.damage(), Optional.empty(), AttackType.UNKNOWN));
    }
  }

  Optional<Last> last(UUID victim) {
    return Optional.ofNullable(last.get(victim));
  }

  void forget(UUID victim) {
    last.remove(victim);
    credits.remove(victim);
  }

  void clear() {
    last.clear();
    credits.clear();
  }
}
