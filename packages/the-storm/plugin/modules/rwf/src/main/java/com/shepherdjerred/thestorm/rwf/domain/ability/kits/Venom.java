// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/VenomAbility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import java.util.Optional;

/**
 * The Venom's poisoned sword: every hit it lands while holding an iron sword, however it lands,
 * poisons its victim and slows them, Poison I and Slowness I for six seconds on top of any they
 * already have, the poison credited to the Venom.
 */
public final class Venom implements Ability {

  public static final String ID = "venom";

  /** How long the poison and the slowness last: 120 ticks. */
  public static final int TICKS = 120;

  @Override
  public String id() {
    return ID;
  }

  @Override
  public void hit(Fighter self, AbilityInput.Hit hit, Arena arena) {
    // Red Warfare checked only the held item, not how the hit landed.
    if (hit.weapon().filter("IRON_SWORD"::equals).isEmpty()) {
      return;
    }
    arena.effect(
        new AbilityEffect.PotionStack(hit.victim(), "poison", 0, TICKS, Optional.of(self.id())));
    arena.effect(
        new AbilityEffect.PotionStack(hit.victim(), "slowness", 0, TICKS, Optional.of(self.id())));
  }
}
