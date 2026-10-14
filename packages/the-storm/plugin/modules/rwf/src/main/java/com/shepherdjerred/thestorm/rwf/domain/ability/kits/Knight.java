package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.ExpansionInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import java.time.Duration;
import java.time.Instant;
import java.util.random.RandomGenerator;

/** A shield raised within eight ticks primes one counterstrike for three seconds. */
public final class Knight implements Ability {
  public static final String ID = "knight";
  public static final Duration RECHARGE = Duration.ofSeconds(12);

  public record State(boolean primed, Instant until) implements KitState {}

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    return new State(false, Instant.EPOCH);
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    expire(self, arena);
    if (input instanceof ExpansionInput.ShieldBlock block
        && block.raisedTicks() >= 0
        && block.raisedTicks() <= 8
        && arena.ready(self.id(), ID)) {
      arena.state(self.id(), new State(true, arena.now().plusSeconds(3)));
      arena.use(self.id(), ID, RECHARGE, true);
      arena.say(self.id(), "Counterstrike ready for 3 seconds!", AbilityEffect.Tone.GOOD);
    }
  }

  @Override
  public DamageFormula.Hit dealing(KitState state, DamageFormula.Hit hit, RandomGenerator random) {
    return hit.attack().has(AttackType.Flag.MELEE) && ((State) state).primed() ? hit.plus(2) : hit;
  }

  @Override
  public void hit(Fighter self, AbilityInput.Hit hit, Arena arena) {
    if (hit.type().has(AttackType.Flag.MELEE))
      arena.state(self.id(), new State(false, Instant.EPOCH));
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    expire(self, arena);
  }

  private static void expire(Fighter self, Arena arena) {
    var state = arena.state(self.id(), State.class);
    if (state.primed() && !arena.now().isBefore(state.until())) {
      arena.state(self.id(), new State(false, Instant.EPOCH));
    }
  }
}
