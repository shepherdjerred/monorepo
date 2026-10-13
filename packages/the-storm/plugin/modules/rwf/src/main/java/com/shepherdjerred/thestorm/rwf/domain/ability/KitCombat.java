// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/damage/CustomDamageEvent.java, the order damage
// mods, armor and the single multiplier apply in); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.random.RandomGenerator;

/**
 * How kits change a hit. The attacker's ability adds its damage mods before armor (a Berserker's
 * bloodlust, a Bleeder's own damage), the victim's applies its single multiplier (a Juggernaut's
 * 0.6, Frost armour), and a kit that fixes damage outright (Equality) has the last word, as Red
 * Warfare's {@code setFinalDamage} did.
 */
public final class KitCombat {

  private KitCombat() {}

  /**
   * One side of a hit.
   *
   * @param kit their kit id
   * @param state their ability state
   */
  public record Side(String kit, KitState state) {}

  /**
   * The damage {@code hit} deals once both sides' kits have had their say.
   *
   * @param hit the hit as the combat rules see it
   * @param attacker who dealt it, when a combatant did
   * @param victim who takes it
   * @param random the match's randomness, for kits that roll
   */
  public static double damage(
      DamageFormula.Hit hit, Optional<Side> attacker, Side victim, RandomGenerator random) {
    return fixed(hit, attacker, victim)
        .orElseGet(() -> DamageFormula.finalDamage(adjusted(hit, attacker, victim, random)));
  }

  /** {@code hit} with the attacker's mods and the victim's multiplier applied. */
  public static DamageFormula.Hit adjusted(
      DamageFormula.Hit hit, Optional<Side> attacker, Side victim, RandomGenerator random) {
    var adjusted = hit;
    if (attacker.isPresent()) {
      var side = attacker.orElseThrow();
      var ability = Abilities.abilityOf(side.kit());
      if (ability.isPresent()) {
        adjusted = ability.orElseThrow().dealing(side.state(), adjusted, random);
      }
    }
    var defence = Abilities.abilityOf(victim.kit());
    if (defence.isPresent()) {
      adjusted = defence.orElseThrow().taking(victim.state(), adjusted, attacker.isPresent());
    }
    return adjusted;
  }

  /** The damage a kit on either side fixes outright, the victim's first. */
  private static Optional<Double> fixed(
      DamageFormula.Hit hit, Optional<Side> attacker, Side victim) {
    var taken = Abilities.abilityOf(victim.kit()).flatMap(a -> boxed(a.fixed(hit.attack())));
    if (taken.isPresent() || attacker.isEmpty()) {
      return taken;
    }
    return Abilities.abilityOf(attacker.orElseThrow().kit())
        .flatMap(a -> boxed(a.fixed(hit.attack())));
  }

  private static Optional<Double> boxed(OptionalDouble value) {
    return value.isPresent() ? Optional.of(value.getAsDouble()) : Optional.empty();
  }

  /** How much of a hit's knockback {@code kit}'s holder takes. */
  public static double knockback(String kit) {
    return Abilities.abilityOf(kit).map(Ability::knockback).orElse(1.0);
  }

  /** Whether {@code kit}'s holder may sprint. */
  public static boolean maySprint(String kit) {
    return Abilities.abilityOf(kit).map(Ability::maySprint).orElse(true);
  }
}
