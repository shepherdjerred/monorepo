package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.ExpansionEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.ExpansionInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import java.time.Duration;
import java.util.Optional;

/** Three finite enemy-only flasks, with a ten-second gap and a three-block splash radius. */
public final class Alchemist implements Ability {
  public static final String ID = "alchemist";
  public static final Duration RECHARGE = Duration.ofSeconds(10);

  public record State(int flasks) implements KitState {}

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    return new State(3);
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (input instanceof ExpansionInput.ThrowFlask) {
      var state = arena.state(self.id(), State.class);
      if (state.flasks() <= 0 || !arena.ready(self.id(), ID)) return;
      arena.state(self.id(), new State(state.flasks() - 1));
      arena.use(self.id(), ID, RECHARGE, true);
      arena.effect(new AbilityEffect.Take(self.id(), "SPLASH_POTION", 1));
      arena.effect(new ExpansionEffect.Flask(self.id()));
    } else if (input instanceof ExpansionInput.FlaskSplash splash) {
      for (var id : splash.targets().stream().distinct().toList()) {
        var target = arena.fighter(id);
        if (target.isPresent()
            && target.orElseThrow().alive()
            && !target.orElseThrow().allyOf(self)) {
          arena.effect(new AbilityEffect.Potion(id, "weakness", 0, 100, Optional.of(self.id())));
          arena.effect(new AbilityEffect.Potion(id, "slowness", 0, 100, Optional.of(self.id())));
        }
      }
    }
  }
}
