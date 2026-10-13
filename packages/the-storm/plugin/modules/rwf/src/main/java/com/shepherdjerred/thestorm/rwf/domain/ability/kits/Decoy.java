package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.time.Duration;

/**
 * The Decoy sends a running copy of itself the way it looks for 6 seconds, and vanishes from the
 * enemy for the first 3 while they chase it. It recharges for 35.
 */
public final class Decoy implements Ability {

  public static final String ID = "decoy";

  public static final Duration RUNS = Duration.ofSeconds(6);
  public static final Duration VANISHED = Duration.ofSeconds(3);
  public static final Duration RECHARGE = Duration.ofSeconds(35);

  private static final String HIDDEN = "decoy-hidden";

  /**
   * A Decoy's vanishing.
   *
   * @param hidden whether it is hidden from the enemy now
   */
  public record State(boolean hidden) implements KitState {}

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
    if (!(input instanceof AbilityInput.Decoy decoy)) {
      return;
    }
    if (!arena.ready(self.id(), ID)) {
      arena.say(self.id(), "Your decoy is not ready yet!", AbilityEffect.Tone.REFUSED);
      return;
    }
    var flat = new Vec3(decoy.direction().x(), 0, decoy.direction().z());
    if (flat.length() < 1.0e-6) {
      arena.say(self.id(), "Look where the decoy should run!", AbilityEffect.Tone.REFUSED);
      return;
    }
    arena.use(self.id(), ID, RECHARGE, true);
    arena.effect(new AbilityEffect.Decoy(self.id(), flat.scaled(1 / flat.length()), RUNS));
    arena.use(self.id(), HIDDEN, VANISHED, false);
    arena.state(self.id(), new State(true));
    arena.effect(new AbilityEffect.Visibility(self.id(), AbilityEffect.Seen.HIDDEN));
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    if (arena.state(self.id(), State.class).hidden() && arena.ready(self.id(), HIDDEN)) {
      reappear(self, arena);
    }
  }

  @Override
  public void died(Fighter self, Death death, Arena arena) {
    if (death.victim().equals(self.id()) && arena.state(self.id(), State.class).hidden()) {
      reappear(self, arena);
    }
  }

  private static void reappear(Fighter self, Arena arena) {
    arena.state(self.id(), new State(false));
    arena.effect(new AbilityEffect.Visibility(self.id(), AbilityEffect.Seen.VISIBLE));
  }
}
