package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.ExpansionInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.time.Duration;

/** One feather jump per landing, with an eight-second cooldown. */
public final class Acrobat implements Ability {
  public static final String ID = "acrobat";
  public static final Duration RECHARGE = Duration.ofSeconds(8);

  public record State(boolean jumped) implements KitState {}

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
    if (!(input instanceof ExpansionInput.AirJump jump)
        || !jump.airborne()
        || arena.state(self.id(), State.class).jumped()
        || !arena.ready(self.id(), ID)) return;
    arena.state(self.id(), new State(true));
    arena.use(self.id(), ID, RECHARGE, true);
    arena.effect(new AbilityEffect.Push(self.id(), new Vec3(0, 0.6 - jump.verticalVelocity(), 0)));
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    if (motion.onGround()) arena.state(self.id(), new State(false));
  }
}
