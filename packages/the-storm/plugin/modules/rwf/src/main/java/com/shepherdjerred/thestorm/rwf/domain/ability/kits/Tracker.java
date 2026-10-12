package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.time.Duration;
import java.util.HashSet;
import java.util.Set;

/**
 * The Tracker reads the ground: it sees the footprints enemies left in the last {@link #TRAIL}
 * (drawn by the server for Trackers alone), and its first hit on each enemy marks that enemy on its
 * team's compasses until they die.
 */
public final class Tracker implements Ability {

  public static final String ID = "tracker";

  /** How old a footprint a Tracker still sees. */
  public static final Duration TRAIL = Duration.ofSeconds(8);

  /**
   * The enemies a Tracker has marked.
   *
   * @param marked who
   */
  public record State(Set<CombatantId> marked) implements KitState {

    public State {
      marked = Set.copyOf(marked);
    }
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    return new State(Set.of());
  }

  @Override
  public void hit(Fighter self, AbilityInput.Hit hit, Arena arena) {
    var state = arena.state(self.id(), State.class);
    var victim = arena.fighter(hit.victim());
    if (state.marked().contains(hit.victim())
        || victim.isEmpty()
        || victim.orElseThrow().allyOf(self)
        || hit.victimHealth() <= 0) {
      return;
    }
    var marked = new HashSet<>(state.marked());
    marked.add(hit.victim());
    arena.state(self.id(), new State(marked));
    arena.effect(new AbilityEffect.Mark(hit.victim(), self.team()));
    arena.say(
        arena.allies(self).stream().map(Fighter::id).toList(),
        self.name() + " marked " + victim.orElseThrow().name() + " on your compasses!",
        AbilityEffect.Tone.INFO);
  }
}
