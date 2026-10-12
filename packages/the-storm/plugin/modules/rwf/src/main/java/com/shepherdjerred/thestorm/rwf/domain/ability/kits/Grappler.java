package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.time.Duration;

/**
 * The Grappler's hook: reeling in pulls the Grappler toward wherever the hook landed, harder the
 * farther it is ({@link #PULL} of the gap a tick, at most {@link #MOST_SPEED} blocks a tick, plus a
 * {@link #LIFT} hop), and it lands without fall damage for 3 seconds. The hook recharges for 5.
 */
public final class Grappler implements Ability {

  public static final String ID = "grappler";

  public static final double PULL = 0.15;
  public static final double MOST_SPEED = 2.5;
  public static final double LIFT = 0.35;
  public static final Duration RECHARGE = Duration.ofSeconds(5);
  public static final Duration SAFE_LANDING = Duration.ofSeconds(3);

  @Override
  public String id() {
    return ID;
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (!(input instanceof AbilityInput.Grapple grapple)) {
      return;
    }
    if (!arena.ready(self.id(), ID)) {
      arena.say(
          self.id(), "Your grappling hook has not recharged yet!", AbilityEffect.Tone.REFUSED);
      return;
    }
    var from = arena.position(self.id());
    if (from.isEmpty()) {
      return;
    }
    arena.use(self.id(), ID, RECHARGE, true);
    arena.effect(new AbilityEffect.Push(self.id(), pull(from.orElseThrow(), grapple.hook())));
    arena.effect(new AbilityEffect.NoFall(self.id(), SAFE_LANDING));
    arena.effect(new AbilityEffect.Cue(self.id(), KitCue.PULLED));
  }

  /** The velocity that pulls someone at {@code from} toward {@code hook}. */
  public static Vec3 pull(Vec3 from, Vec3 hook) {
    var gap = hook.minus(from).scaled(PULL);
    var length = gap.length();
    if (length > MOST_SPEED) {
      gap = gap.scaled(MOST_SPEED / length);
    }
    return gap.plus(new Vec3(0, LIFT, 0));
  }
}
