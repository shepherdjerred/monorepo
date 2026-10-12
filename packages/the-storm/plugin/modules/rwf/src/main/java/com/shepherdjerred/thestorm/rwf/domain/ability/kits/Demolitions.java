// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// DemolitionsAbility.java and Landmine.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitAttacks;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitText;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.ability.Placed;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Demolitions' landmines. A placed pressure plate arms 2 seconds later; an enemy stepping on an
 * armed one sets it off, and it explodes 0.7 seconds after (power 6, at most 30 damage, no block
 * damage), credited to its owner. A mine ignores feet for its first 0.1 seconds armed. Striking a
 * mine only tells the striker whose it is: as in Red Warfare, whose left-click handler cancelled
 * the dig, nobody can break one, so its pick-up code never ran. A new mine arrives 40 seconds after
 * one explodes, and every mine goes when its owner dies. (Demolitions' Bomb Speed V fuse is part of
 * its kit.)
 */
public final class Demolitions implements Ability {

  public static final String ID = "demolitions";

  /** The block a landmine is. */
  public static final String PLATE = "STONE_PRESSURE_PLATE";

  public static final Duration ARMING = Duration.ofSeconds(2);

  /** How long an armed mine ignores feet, Red Warfare's {@code elasped(lastState, 100)}. */
  public static final Duration SETTLE = Duration.ofMillis(100);

  public static final Duration FUSE = Duration.ofMillis(700);
  public static final Duration RESTOCK = Duration.ofSeconds(40);
  public static final float POWER = 6;
  public static final double MOST_DAMAGE = 30;

  /** A returned mine is always given, however many are held. */
  private static final int CAP = Integer.MAX_VALUE;

  /**
   * When new landmines arrive.
   *
   * @param restocks when each one is due
   */
  public record State(List<Instant> restocks) implements KitState {

    public State {
      restocks = List.copyOf(restocks);
    }
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    return new State(List.of());
  }

  /** The landmine item the kit carries, one of it. */
  public static ItemSpec landmine() {
    return KitBook.DEMOLITIONS.hotbar().get(1).times(1);
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (!(input instanceof AbilityInput.PlaceMine place)) {
      return;
    }
    if (arena.placed().stream().anyMatch(p -> p.blocks().contains(place.block()))) {
      return;
    }
    arena.place(
        new Placed.Mine(self.id(), place.block(), arena.now(), Optional.empty(), Optional.empty()));
    arena.effect(new AbilityEffect.Take(self.id(), PLATE, 1));
    arena.effect(new AbilityEffect.PlaceBlock(place.block(), PLATE));
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    for (var mine : mines(self.id(), arena)) {
      if (mine.armedAt().isEmpty()) {
        if (arena.now().isAfter(mine.placedAt().plus(ARMING))) {
          arena.replace(
              mine,
              new Placed.Mine(
                  mine.owner(),
                  mine.block(),
                  mine.placedAt(),
                  Optional.of(arena.now()),
                  Optional.empty()));
          arena.effect(new AbilityEffect.CueAt(mine.block(), KitCue.MINE_ARMED));
          arena.say(
              self.id(), KitText.GREEN + "Your landmine is now armed!", AbilityEffect.Tone.GOOD);
        }
      } else if (mine.triggeredAt().isPresent()
          && arena.now().isAfter(mine.triggeredAt().orElseThrow().plus(FUSE))) {
        arena.unplace(mine);
        arena.effect(new AbilityEffect.ClearBlock(mine.block()));
        arena.effect(
            new AbilityEffect.Explode(
                mine.block().center(),
                POWER,
                MOST_DAMAGE,
                self.id(),
                KitAttacks.LANDMINE,
                KitAttacks.LANDMINE,
                0));
        restockLater(self.id(), arena);
      }
    }
    var state = arena.state(self.id(), State.class);
    var due = new ArrayList<Instant>();
    for (var at : state.restocks()) {
      if (!arena.now().isAfter(at)) {
        due.add(at);
      } else {
        arena.effect(new AbilityEffect.Give(self.id(), landmine(), CAP));
        arena.effect(new AbilityEffect.Cue(self.id(), KitCue.RESTOCKED));
      }
    }
    if (due.size() != state.restocks().size()) {
      arena.state(self.id(), new State(due));
    }
  }

  private static void restockLater(CombatantId owner, Arena arena) {
    var state = arena.state(owner, State.class);
    var restocks = new ArrayList<>(state.restocks());
    restocks.add(arena.now().plus(RESTOCK));
    arena.state(owner, new State(restocks));
  }

  @Override
  public void touched(Fighter owner, Fighter actor, AbilityInput.Touch touch, Arena arena) {
    var mine =
        mines(owner.id(), arena).stream().filter(m -> m.block().equals(touch.block())).findFirst();
    if (mine.isEmpty()) {
      return;
    }
    switch (touch) {
      case AbilityInput.StepOnMine _ -> stepped(owner, actor, mine.orElseThrow(), arena);
      case AbilityInput.BreakMine _ -> broken(owner, actor, arena);
      default -> {}
    }
  }

  private static void stepped(Fighter owner, Fighter actor, Placed.Mine mine, Arena arena) {
    if (actor.allyOf(owner)
        || mine.armedAt().isEmpty()
        || mine.triggeredAt().isPresent()
        || !arena.now().isAfter(mine.armedAt().orElseThrow().plus(SETTLE))) {
      return;
    }
    arena.replace(
        mine,
        new Placed.Mine(
            mine.owner(), mine.block(), mine.placedAt(), mine.armedAt(), Optional.of(arena.now())));
    arena.effect(new AbilityEffect.CueAt(mine.block(), KitCue.MINE_TRIGGERED));
    arena.say(
        owner.id(), KitText.GOLD + "One of your landmines just went off", AbilityEffect.Tone.INFO);
  }

  /** Anyone striking a mine, its owner too, is told whose it is; it stays where it is. */
  private static void broken(Fighter owner, Fighter actor, Arena arena) {
    arena.say(
        actor.id(),
        KitText.GOLD
            + "This is "
            + KitText.team(owner.team())
            + owner.name()
            + "'s "
            + KitText.GOLD
            + "landmine",
        AbilityEffect.Tone.INFO);
  }

  @Override
  public void died(Fighter self, Death death, Arena arena) {
    if (!death.victim().equals(self.id())) {
      return;
    }
    for (var mine : mines(self.id(), arena)) {
      arena.unplace(mine);
      arena.effect(new AbilityEffect.ClearBlock(mine.block()));
    }
  }

  /** {@code owner}'s landmines, oldest first. */
  public static List<Placed.Mine> mines(CombatantId owner, Arena arena) {
    return arena.placed().stream()
        .filter(p -> p instanceof Placed.Mine m && m.owner().equals(owner))
        .map(Placed.Mine.class::cast)
        .toList();
  }
}
