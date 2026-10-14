package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.ExpansionEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.ExpansionInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import java.time.Duration;

/** Axe contact disables a raised enemy shield for three seconds, every twelve seconds. */
public final class Ravager implements Ability {
  public static final String ID = "ravager";
  public static final Duration RECHARGE = Duration.ofSeconds(12);

  @Override
  public String id() {
    return ID;
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (!(input instanceof ExpansionInput.ShieldContact contact) || !arena.ready(self.id(), ID))
      return;
    var target = arena.fighter(contact.victim());
    if (target.isEmpty() || !target.orElseThrow().alive() || target.orElseThrow().allyOf(self))
      return;
    arena.use(self.id(), ID, RECHARGE, true);
    arena.effect(new ExpansionEffect.DisableShield(contact.victim(), 60));
  }
}
