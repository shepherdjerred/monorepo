// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/WarperAbility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Legacy;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * The Warper's wand: used on an enemy, it sends them and every enemy within 3 blocks of them to
 * where the Warper stood about 10 seconds ago, crediting any fall to the Warper. The wand recharges
 * for 30 seconds, and starts the match recharging for 10. The Warper's trail keeps every safe place
 * it stood, dropping the oldest once the next is also over 10 seconds old, unless the oldest is
 * still safe and the next is not. Victims land facing the way the Warper faced there, as Red
 * Warfare teleported them to its stored location.
 */
public final class Warper implements Ability {

  public static final String ID = "warper";

  public static final Duration WINDOW = Duration.ofSeconds(10);
  public static final Duration RECHARGE = Duration.ofSeconds(30);
  public static final Duration FIRST_RECHARGE = Duration.ofSeconds(10);

  /**
   * A place the Warper stood.
   *
   * @param at where
   * @param yaw which way it faced, in degrees
   * @param pitch how far up or down it looked, in degrees
   * @param time when
   */
  public record Stamp(Vec3 at, float yaw, float pitch, Instant time) {}

  /**
   * The Warper's trail, oldest first.
   *
   * @param trail where it stood
   */
  public record State(List<Stamp> trail) implements KitState {

    public State {
      trail = List.copyOf(trail);
    }

    /** Where a warp lands: the oldest place in the trail. */
    public Optional<Stamp> landing() {
      return trail.isEmpty() ? Optional.empty() : Optional.of(trail.getFirst());
    }
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    arena.use(self.id(), ID, FIRST_RECHARGE, true);
    return new State(List.of());
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    var trail = new ArrayList<>(arena.state(self.id(), State.class).trail());
    // As Red Warfare: the oldest spot goes once the next is out of the window too, unless it is
    // still a safe landing and the next has stopped being one; the ground is read again each tick.
    while (trail.size() > 1
        && old(trail.get(1), arena.now())
        && (!arena.safe(trail.getFirst().at()) || arena.safe(trail.get(1).at()))) {
      trail.removeFirst();
    }
    if (motion.safe()) {
      trail.add(
          new Stamp(motion.position(), (float) motion.yaw(), (float) motion.pitch(), arena.now()));
    }
    arena.state(self.id(), new State(trail));
  }

  private static boolean old(Stamp stamp, Instant now) {
    return Duration.between(stamp.time(), now).compareTo(WINDOW) > 0;
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (!(input instanceof AbilityInput.Warp warp)) {
      return;
    }
    if (!arena.ready(self.id(), ID)) {
      arena.say(
          self.id(), Legacy.RED + "Your wand has not recharged yet!", AbilityEffect.Tone.LEGACY);
      return;
    }
    var landing = arena.state(self.id(), State.class).landing();
    if (landing.isEmpty()) {
      arena.say(
          self.id(),
          Legacy.RED + "No landing spots found in the last 10 seconds!",
          AbilityEffect.Tone.LEGACY);
      return;
    }
    var targets =
        warp.targets().stream()
            .distinct()
            .flatMap(id -> arena.fighter(id).stream())
            .filter(target -> target.alive() && !target.allyOf(self))
            .toList();
    if (targets.isEmpty()) {
      return;
    }
    arena.say(
        self.id(),
        Legacy.DARK_AQUA + "The energy drains out of your wand",
        AbilityEffect.Tone.LEGACY);
    arena.use(self.id(), ID, RECHARGE, true);
    arena.state(self.id(), new State(List.of()));
    var to = landing.orElseThrow();
    for (var target : targets) {
      arena.say(
          target.id(),
          Legacy.DARK_AQUA + "Warped by " + Legacy.team(self.team()) + self.name(),
          AbilityEffect.Tone.LEGACY);
      arena.effect(new AbilityEffect.Cue(target.id(), KitCue.WARPED));
      arena.effect(
          new AbilityEffect.Send(
              target.id(), to.at(), to.yaw(), to.pitch(), Optional.of(self.id())));
      arena.effect(new AbilityEffect.Cue(target.id(), KitCue.WARPED));
    }
  }

  @Override
  public void died(Fighter self, Death death, Arena arena) {
    if (death.victim().equals(self.id())) {
      arena.state(self.id(), new State(List.of()));
    }
  }
}
