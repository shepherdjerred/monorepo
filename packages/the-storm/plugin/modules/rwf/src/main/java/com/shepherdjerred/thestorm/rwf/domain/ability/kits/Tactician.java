package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.ability.TacticalEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.TacticalInput;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/** A horn rewards a completed stationary windup; interruption grants no buffs. */
public final class Tactician implements Ability {
  public static final String ID = "tactician";
  public static final Duration RECHARGE = Duration.ofSeconds(40);
  public static final Duration WINDUP = Duration.ofMillis(1200);
  public static final double REACH = 8;

  public record Cast(Vec3 at, Instant readyAt) {}

  public record State(Optional<Cast> casting) implements KitState {}

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    return new State(Optional.empty());
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (!(input instanceof TacticalInput.Rally rally)
        || !arena.ready(self.id(), ID)
        || arena.state(self.id(), State.class).casting().isPresent()) return;
    arena.state(self.id(), new State(Optional.of(new Cast(rally.at(), arena.now().plus(WINDUP)))));
    arena.effect(new TacticalEffect.RallySignal(self.id(), TacticalEffect.Stage.WINDUP));
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    var cast = arena.state(self.id(), State.class).casting();
    if (cast.isEmpty()) return;
    if (cast.orElseThrow().at().distanceTo(motion.position()) > 0.15) {
      cancel(self, arena);
      return;
    }
    if (arena.now().isBefore(cast.orElseThrow().readyAt())) return;
    arena.state(self.id(), new State(Optional.empty()));
    arena.use(self.id(), ID, RECHARGE, true);
    for (var ally : TacticalAllies.nearby(self, motion.position(), REACH, arena)) {
      arena.effect(new AbilityEffect.Potion(ally.id(), "speed", 0, 120, Optional.of(self.id())));
      arena.effect(
          new AbilityEffect.Potion(ally.id(), "resistance", 0, 120, Optional.of(self.id())));
    }
    arena.effect(new TacticalEffect.RallySignal(self.id(), TacticalEffect.Stage.COMPLETE));
  }

  @Override
  public void hurt(Fighter self, AbilityInput.Hurt hurt, Arena arena) {
    if (hurt.damage() > 0) cancel(self, arena);
  }

  @Override
  public void died(Fighter self, Death death, Arena arena) {
    if (death.victim().equals(self.id())) cancel(self, arena);
  }

  @Override
  public void ended(Fighter self, Arena arena) {
    cancel(self, arena);
  }

  private static void cancel(Fighter self, Arena arena) {
    if (arena.state(self.id(), State.class).casting().isEmpty()) return;
    arena.state(self.id(), new State(Optional.empty()));
    arena.effect(new TacticalEffect.RallySignal(self.id(), TacticalEffect.Stage.CANCELLED));
  }
}
