// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/SpyAbility.java
// and redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java,
// setupScoreboards); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.util.Optional;

/**
 * The Spy looks to every viewer like one of their own team: its name tag takes each viewer's team
 * colour, and anyone looking at its kit sees a Trooper.
 */
public final class Spy implements Ability {

  public static final String ID = "spy";

  /** The kit the enemy believes a Spy carries. */
  public static final String SHOWN_AS = KitBook.TROOPER.id();

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    arena.effect(
        new AbilityEffect.Disguise(
            self.id(), Optional.of(new AbilityEffect.Disguised(self.name(), Optional.empty()))));
    return KitState.NONE;
  }

  @Override
  public boolean disguised(KitState state) {
    return true;
  }
}
