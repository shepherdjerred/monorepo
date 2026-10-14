package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.TacticalEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.TacticalInput;
import java.time.Duration;

/** A placed listening device consumes real sound cues, rather than sensing silent enemies. */
public final class Warden implements Ability {
  public static final String ID = "warden";
  public static final Duration RECHARGE = Duration.ofSeconds(35);
  public static final Duration LIFETIME = Duration.ofSeconds(30);
  public static final Duration REPORT_GAP = Duration.ofSeconds(3);
  public static final double REACH = 12;

  @Override
  public String id() {
    return ID;
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (!(input instanceof TacticalInput.Deploy deploy) || !arena.ready(self.id(), ID)) return;
    arena.use(self.id(), ID, RECHARGE, true);
    arena.effect(new TacticalEffect.ListeningPost(self.id(), deploy.at()));
  }
}
