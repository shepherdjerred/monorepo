// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// JuggernautAbility.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;

/**
 * The Juggernaut: 15 hearts, takes 60% of every hit someone deals it (75% of explosions) but the
 * whole of falls, fire and the poison, takes only 80% of knockback, and cannot sprint.
 */
public final class Juggernaut implements Ability {

  public static final String ID = "juggernaut";

  public static final double MAX_HEALTH = 30;
  public static final double HIT_SHARE = 0.6;
  public static final double EXPLOSION_SHARE = 0.75;
  public static final double KNOCKBACK = 0.8;

  @Override
  public String id() {
    return ID;
  }

  /** How far Red Warfare lifted a Juggernaut, and how fast, a tick after the match went live. */
  public static final double HOP = 0.1;

  /**
   * Whether the Juggernaut has had its hop yet.
   *
   * @param hopped whether it has
   */
  public record State(boolean hopped) implements KitState {}

  @Override
  public KitState start(Fighter self, Arena arena) {
    arena.effect(new AbilityEffect.MaxHealth(self.id(), MAX_HEALTH, true));
    return new State(false);
  }

  /**
   * A tick after going live Red Warfare lifted each Juggernaut a tenth of a block and set it moving
   * up at a tenth of a block a tick, with the first health update the food trick rode on.
   */
  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    if (!arena.state(self.id(), State.class).hopped()) {
      arena.state(self.id(), new State(true));
      arena.effect(new AbilityEffect.Hop(self.id(), HOP));
    }
  }

  @Override
  public DamageFormula.Hit taking(KitState state, DamageFormula.Hit hit, boolean direct) {
    if (!direct || hit.attack().has(AttackType.Flag.IGNORE_ARMOR)) {
      return hit;
    }
    return hit.times(hit.attack().has(AttackType.Flag.EXPLOSION) ? EXPLOSION_SHARE : HIT_SHARE);
  }

  @Override
  public double knockback() {
    return KNOCKBACK;
  }

  @Override
  public boolean maySprint() {
    return false;
  }
}
