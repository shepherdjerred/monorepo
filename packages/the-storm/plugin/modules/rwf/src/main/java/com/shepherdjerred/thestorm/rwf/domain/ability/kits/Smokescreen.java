package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.TacticalEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.TacticalInput;
import java.time.Duration;

/** A short, shared visual barrier; physical attacks and audible cues continue through it. */
public final class Smokescreen implements Ability {
  public static final String ID = "smokescreen";
  public static final Duration RECHARGE = Duration.ofSeconds(30);
  public static final Duration LIFETIME = Duration.ofSeconds(6);
  public static final double RADIUS = 4;

  @Override
  public String id() {
    return ID;
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (!(input instanceof TacticalInput.Smoke smoke) || !arena.ready(self.id(), ID)) return;
    arena.use(self.id(), ID, RECHARGE, true);
    arena.effect(new TacticalEffect.Smoke(self.id(), smoke.at()));
  }
}
