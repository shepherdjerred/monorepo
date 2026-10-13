// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/SkinnerAbility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitText;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * The Skinner, as Red Warfare's {@code onNewDeath} ran it: whenever an enemy dies within 7 blocks
 * of a living Skinner, it rips their skin off, remembering how they looked (their skin and armour,
 * or a Trooper's armour for a Ghost or Wraith). On Red Warfare's half-second clock each skin being
 * put on bleeds redstone, and once more than 3 seconds have passed since the death the Skinner
 * finishes getting dressed: to the enemy it wears that player's skin, armour and name, in that
 * player's team colour. Several skins can be put on at once; the last to finish is the one worn.
 * Its own death undresses it.
 *
 * <p>The kit's description promises it is defenceless while it dresses; Red Warfare's code never
 * did that, and neither does this.
 */
public final class Skinner implements Ability {

  public static final String ID = "skinner";

  public static final double REACH = 7;

  /** How long dressing takes; done once strictly more than this has passed. */
  public static final Duration DRESSING = Duration.ofSeconds(3);

  /** Red Warfare's half-second clock, on which dressing bleeds and finishes. */
  public static final Duration CLOCK = Duration.ofMillis(500);

  /**
   * A skin being put on.
   *
   * @param victim whose
   * @param name their name
   * @param team their team
   * @param taken when they died
   */
  public record Skin(CombatantId victim, String name, TeamColor team, Instant taken) {

    /** Whether the Skinner is dressed at {@code now}. */
    boolean ready(Instant now) {
      return now.isAfter(taken.plus(DRESSING));
    }
  }

  /**
   * A Skinner's state.
   *
   * @param dressing the skins being put on, oldest first
   * @param wearing the team whose skin it wears, once dressed
   * @param nextBeat the next tick of the half-second clock
   */
  public record State(List<Skin> dressing, Optional<TeamColor> wearing, Instant nextBeat)
      implements KitState {

    public State {
      dressing = List.copyOf(dressing);
    }
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    return new State(List.of(), Optional.empty(), arena.now().plus(CLOCK));
  }

  @Override
  public boolean disguised(KitState state) {
    return state instanceof State skinner && skinner.wearing().isPresent();
  }

  @Override
  public void died(Fighter self, Death death, Arena arena) {
    var state = arena.state(self.id(), State.class);
    if (death.victim().equals(self.id())) {
      arena.state(self.id(), new State(List.of(), Optional.empty(), state.nextBeat()));
      if (state.wearing().isPresent()) {
        arena.effect(new AbilityEffect.Disguise(self.id(), Optional.empty()));
        arena.effect(new AbilityEffect.Skin(self.id(), Optional.empty()));
      }
      return;
    }
    var victim = arena.fighter(death.victim());
    if (!self.alive()
        || victim.isEmpty()
        || victim.orElseThrow().allyOf(self)
        || death.at().isEmpty()) {
      return;
    }
    var near =
        arena.position(self.id()).filter(at -> at.distanceTo(death.at().orElseThrow()) <= REACH);
    if (near.isEmpty()) {
      return;
    }
    var skinned = victim.orElseThrow();
    arena.say(
        self.id(),
        "You rip " + skinned.name() + "'s skin off their body and start getting dressed!",
        AbilityEffect.Tone.INFO);
    arena.say(
        skinned.id(),
        KitText.DARK_RED + "You scream as " + self.name() + " skins you!",
        AbilityEffect.Tone.REFUSED);
    arena.effect(new AbilityEffect.SnapSkin(self.id(), skinned.id()));
    var dressing = new ArrayList<>(state.dressing());
    dressing.add(new Skin(skinned.id(), skinned.name(), skinned.team(), arena.now()));
    arena.state(self.id(), new State(dressing, state.wearing(), state.nextBeat()));
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    var state = arena.state(self.id(), State.class);
    if (arena.now().isBefore(state.nextBeat())) {
      return;
    }
    var next = state.nextBeat();
    while (!arena.now().isBefore(next)) {
      next = next.plus(CLOCK);
    }
    var wearing = state.wearing();
    var left = new ArrayList<Skin>();
    for (var skin : state.dressing()) {
      arena.effect(new AbilityEffect.Cue(self.id(), KitCue.SKINNING));
      if (!skin.ready(arena.now())) {
        left.add(skin);
        continue;
      }
      wearing = Optional.of(skin.team());
      arena.effect(
          new AbilityEffect.Disguise(
              self.id(),
              Optional.of(new AbilityEffect.Disguised(skin.name(), Optional.of(skin.team())))));
      arena.effect(new AbilityEffect.Skin(self.id(), Optional.of(skin.victim())));
      arena.say(self.id(), "You finish getting dressed!", AbilityEffect.Tone.INFO);
    }
    arena.state(self.id(), new State(left, wearing, next));
  }
}
