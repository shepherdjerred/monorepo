package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.TacticalInput;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import java.time.Duration;
import java.util.Optional;

/** Three finite supply bundles; an empty wave wastes neither a bundle nor its recharge. */
public final class Quartermaster implements Ability {
  public static final String ID = "quartermaster";
  public static final Duration RECHARGE = Duration.ofSeconds(20);
  public static final double REACH = 6;

  public record State(int bundles) implements KitState {}

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
    if (!(input instanceof TacticalInput.Supply supply) || !arena.ready(self.id(), ID)) return;
    var state = arena.state(self.id(), State.class);
    var allies = TacticalAllies.nearby(self, supply.at(), REACH, arena);
    if (state.bundles() == 0 || allies.isEmpty()) return;
    arena.state(self.id(), new State(state.bundles() - 1));
    arena.use(self.id(), ID, RECHARGE, true);
    arena.effect(new AbilityEffect.Take(self.id(), "BUNDLE", 1));
    for (var ally : allies) {
      arena.effect(new AbilityEffect.Give(ally.id(), ItemSpec.of("ARROW", 8), Integer.MAX_VALUE));
      arena.effect(
          new AbilityEffect.Potion(ally.id(), "absorption", 0, 80, Optional.of(self.id())));
    }
  }
}
