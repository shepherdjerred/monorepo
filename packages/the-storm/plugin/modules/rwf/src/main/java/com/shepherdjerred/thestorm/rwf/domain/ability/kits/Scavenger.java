package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.ExpansionEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/** The first three credited kills leave private, ten-second salvage at the victim's feet. */
public final class Scavenger implements Ability {
  public static final String ID = "scavenger";

  public record Drop(Vec3 at, Instant until) {}

  public record State(int earned, Map<CombatantId, Drop> drops) implements KitState {
    public State {
      drops = Map.copyOf(drops);
    }
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    return new State(0, Map.of());
  }

  @Override
  public void died(Fighter self, Death death, Arena arena) {
    if (death.victim().equals(self.id())) {
      clear(self, arena);
      return;
    }
    var state = arena.state(self.id(), State.class);
    if (state.earned() >= 3
        || death.killer().filter(self.id()::equals).isEmpty()
        || death.at().isEmpty()) return;
    var drops = new HashMap<>(state.drops());
    var at = death.at().orElseThrow();
    drops.put(death.victim(), new Drop(at, arena.now().plusSeconds(10)));
    arena.state(self.id(), new State(state.earned() + 1, drops));
    arena.effect(new ExpansionEffect.Salvage(self.id(), death.victim(), at));
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    var state = arena.state(self.id(), State.class);
    var drops = new HashMap<>(state.drops());
    for (var entry : state.drops().entrySet()) {
      var expired = !arena.now().isBefore(entry.getValue().until());
      var collected = !expired && motion.position().distanceTo(entry.getValue().at()) <= 1.5;
      if (!expired && !collected) continue;
      drops.remove(entry.getKey());
      arena.effect(new ExpansionEffect.ClearSalvage(self.id(), entry.getKey()));
      if (collected) {
        arena.effect(new AbilityEffect.Heal(self.id(), 4));
        arena.effect(new AbilityEffect.Give(self.id(), ItemSpec.of("ARROW", 8), 64));
      }
    }
    arena.state(self.id(), new State(state.earned(), drops));
  }

  @Override
  public void ended(Fighter self, Arena arena) {
    clear(self, arena);
  }

  private static void clear(Fighter self, Arena arena) {
    var state = arena.state(self.id(), State.class);
    state
        .drops()
        .keySet()
        .forEach(victim -> arena.effect(new ExpansionEffect.ClearSalvage(self.id(), victim)));
    arena.state(self.id(), new State(state.earned(), Map.of()));
  }
}
