// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// BleederAbility.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import java.util.random.RandomGenerator;

/**
 * The Bleeder: its melee hits deal 2 plus up to 1 more in place of the weapon's damage, armor still
 * applying, and every hit that lands takes that much from the victim's max health for good, down to
 * half a heart.
 */
public final class Bleeder implements Ability {

  public static final String ID = "bleeder";

  public static final double BASE = 2;
  public static final double SPREAD = 1;
  public static final double FLOOR = 0.5;

  @Override
  public String id() {
    return ID;
  }

  @Override
  public DamageFormula.Hit dealing(KitState state, DamageFormula.Hit hit, RandomGenerator random) {
    if (!hit.attack().has(AttackType.Flag.MELEE)) {
      return hit;
    }
    // Red Warfare zeroed the initial damage and added its own; the weapon's Sharpness still adds.
    return hit.withBase(0).plus(BASE + random.nextDouble() * SPREAD);
  }

  @Override
  public void hit(Fighter self, AbilityInput.Hit hit, Arena arena) {
    if (!hit.type().has(AttackType.Flag.MELEE) || hit.victimHealth() <= 0) {
      return;
    }
    var shrunk = Math.max(FLOOR, hit.victimMaxHealth() - hit.damage());
    arena.effect(new AbilityEffect.MaxHealth(hit.victim(), shrunk, false));
    arena.effect(new AbilityEffect.Cue(hit.victim(), KitCue.BLED));
  }
}
