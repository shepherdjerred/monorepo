// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// EqualityAbility.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import java.util.OptionalDouble;

/** Equality: every melee or arrow hit it deals or takes does exactly 3 damage. */
public final class Equality implements Ability {

  public static final String ID = "equality";

  public static final double DAMAGE = 3;

  @Override
  public String id() {
    return ID;
  }

  @Override
  public OptionalDouble fixed(AttackType attack) {
    if (attack.has(AttackType.Flag.MELEE) || attack.has(AttackType.Flag.PROJECTILE)) {
      return OptionalDouble.of(DAMAGE);
    }
    return OptionalDouble.empty();
  }
}
