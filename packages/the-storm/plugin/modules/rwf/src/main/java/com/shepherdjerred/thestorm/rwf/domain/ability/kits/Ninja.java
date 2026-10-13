// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/NinjaAbility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import java.util.Optional;

/** The Ninja runs with Speed II and sees with Night Vision for the whole match. */
public final class Ninja implements Ability {

  public static final String ID = "ninja";

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    arena.effect(
        new AbilityEffect.Potion(self.id(), "speed", 1, AbilityEffect.FOREVER, Optional.empty()));
    arena.effect(
        new AbilityEffect.Potion(
            self.id(), "night_vision", 0, AbilityEffect.FOREVER, Optional.empty()));
    return KitState.NONE;
  }
}
