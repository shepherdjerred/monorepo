package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.ExpansionInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import java.time.Duration;
import java.util.random.RandomGenerator;

/** Fully drawn shots travelling twenty-four blocks earn two raw damage every eight seconds. */
public final class Marksman implements Ability {
  public static final String ID = "marksman";
  public static final Duration RECHARGE = Duration.ofSeconds(8);

  public record State(boolean longShot) implements KitState {}

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
      arena.state(
          self.id(),
          new State(
              facts.type().has(AttackType.Flag.PROJECTILE)
                  && facts.fullyDrawn()
                  && facts.distance() >= 24
                  && arena.ready(self.id(), ID)));
    }
  }

  @Override
  public DamageFormula.Hit dealing(KitState state, DamageFormula.Hit hit, RandomGenerator random) {
    return hit.attack().has(AttackType.Flag.PROJECTILE) && ((State) state).longShot()
        ? hit.plus(2)
        : hit;
  }

  @Override
  public void hit(Fighter self, AbilityInput.Hit hit, Arena arena) {
    if (hit.type().has(AttackType.Flag.PROJECTILE)
        && arena.state(self.id(), State.class).longShot()) {
      arena.use(self.id(), ID, RECHARGE, true);
      arena.state(self.id(), new State(false));
    }
  }
}
