package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.ExpansionInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import java.util.random.RandomGenerator;

/** An isolated melee duel earns 1.5 raw damage before armour. */
public final class Duelist implements Ability {
  public static final String ID = "duelist";
  public static final double RADIUS = 6;

  public record State(boolean isolated) implements KitState {}

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    return new State(false);
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (input instanceof ExpansionInput.StrikeFacts facts) {
      arena.state(self.id(), new State(facts.isolated()));
    }
  }

  @Override
  public DamageFormula.Hit dealing(KitState state, DamageFormula.Hit hit, RandomGenerator random) {
    return hit.attack().has(AttackType.Flag.MELEE) && ((State) state).isolated()
        ? hit.plus(1.5)
        : hit;
  }
}
