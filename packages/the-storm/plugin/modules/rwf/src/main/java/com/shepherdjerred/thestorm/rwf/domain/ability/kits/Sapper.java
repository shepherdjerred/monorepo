package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;

/**
 * The Sapper, a bomb disposal expert: explosions do it half the harm they do anyone else. (Its Bomb
 * Defusing III fuse is part of its kit.)
 */
public final class Sapper implements Ability {

  public static final String ID = "sapper";

  public static final double EXPLOSION_SHARE = 0.5;

  @Override
  public String id() {
    return ID;
  }

  @Override
  public DamageFormula.Hit taking(KitState state, DamageFormula.Hit hit, boolean direct) {
    return hit.attack().has(AttackType.Flag.EXPLOSION) ? hit.times(EXPLOSION_SHARE) : hit;
  }
}
