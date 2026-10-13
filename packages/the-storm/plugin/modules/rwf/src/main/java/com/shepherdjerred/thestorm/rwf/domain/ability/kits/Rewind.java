// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// RewinderAbility.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.kit.RewindTrail;
import java.time.Duration;
import java.util.Optional;

/**
 * The Rewind kit's Time Machine. Every tick the holder's trail drops what has left its window and,
 * when they stand somewhere safe, records where they stand and which way they face. Using the clock
 * sends them to the oldest spot in the trail, clears it, and starts a {@link #COOLDOWN} shown on
 * the experience bar; the server also ejects them, stops them, puts out fire and forgets who last
 * knocked them. The clock starts on cooldown when the match goes live, and a death forgets the
 * trail.
 */
public final class Rewind implements Ability {

  /** The ability id named by the Rewind kit, and the clock's cooldown key. */
  public static final String ID = "rewind";

  public static final Duration COOLDOWN = Duration.ofSeconds(30);

  /** Red Warfare's refusal while the clock recharges, in red. */
  public static final String UNSTABLE =
      "Your timestream is too unstable! Attempting to use it now would kill you!";

  /** Red Warfare's refusal with an empty trail, in red; it said 10 seconds of a 30 second trail. */
  public static final String NO_LANDING = "No landing spots found in the last 10 seconds!";

  /**
   * A holder's trail.
   *
   * @param trail where they have stood
   */
  public record Clock(RewindTrail trail) implements KitState {}

  /** Why the clock cannot be used now, if it cannot. */
  public enum Refusal {
    COOLING_DOWN,
    NO_LANDING
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    arena.use(self.id(), ID, COOLDOWN, true);
    return new Clock(RewindTrail.empty());
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    var trail = arena.state(self.id(), Clock.class).trail().trimmed(arena.now(), arena::safe);
    if (arena.safe(motion.position())) {
      trail =
          trail.record(
              new RewindTrail.Spot(motion.position(), (float) motion.yaw(), (float) motion.pitch()),
              arena.now());
    }
    arena.state(self.id(), new Clock(trail));
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (!(input instanceof AbilityInput.Rewind)) {
      return;
    }
    var clock = arena.state(self.id(), Clock.class);
    var refusal = refusal(arena.ready(self.id(), ID), clock);
    if (refusal.isPresent()) {
      arena.say(
          self.id(),
          refusal.orElseThrow() == Refusal.COOLING_DOWN ? UNSTABLE : NO_LANDING,
          AbilityEffect.Tone.REFUSED);
      return;
    }
    arena.use(self.id(), ID, COOLDOWN, true);
    arena.state(self.id(), new Clock(clock.trail().cleared()));
    arena.effect(new AbilityEffect.TimeTravel(self.id(), clock.trail().landing().orElseThrow()));
  }

  @Override
  public void died(Fighter self, Death death, Arena arena) {
    if (death.victim().equals(self.id())) {
      arena.state(self.id(), new Clock(arena.state(self.id(), Clock.class).trail().cleared()));
    }
  }

  /** Why a clock with {@code clock}'s trail, {@code ready} or not, refuses a use now. */
  public static Optional<Refusal> refusal(boolean ready, Clock clock) {
    if (!ready) {
      return Optional.of(Refusal.COOLING_DOWN);
    }
    return clock.trail().landing().isEmpty() ? Optional.of(Refusal.NO_LANDING) : Optional.empty();
  }
}
