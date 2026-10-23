package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;

/**
 * One tick's input to the reflex layer.
 *
 * @param self the bot's own view
 * @param snapshot the world
 * @param decision the standing decision from the think step
 * @param target the enemy to fight right now, if one is visible
 * @param gapplesLeft golden apples in the inventory
 * @param perceived every enemy the bot perceives this tick, target or not, nearest first; never one
 *     it cannot see, so nothing reacts to a player hidden behind a wall or invisible
 */
public record ReflexInput(
    CombatantView self,
    WorldSnapshot snapshot,
    Decision decision,
    Optional<CombatantView> target,
    int gapplesLeft,
    List<CombatantView> perceived) {

  public ReflexInput {
    if (gapplesLeft < 0) {
      throw new IllegalArgumentException("gapples must not be negative");
    }
    perceived = List.copyOf(perceived);
  }

  /**
   * The input for {@code self} given what it perceives, with {@code gapplesLeft} apples: the
   * decided target when visible, otherwise only an enemy close enough to hit back at. Whether to
   * fight anyone further away is the think step's call, so a bot holding its slot never charges.
   */
  public static ReflexInput of(
      CombatantView self, WorldSnapshot snapshot, Decision decision, Percept percept) {
    return new ReflexInput(
        self, snapshot, decision, resolveTarget(self, decision, percept), 0, percept.visible());
  }

  /** The enemy {@code self} should fight this tick, if any. */
  public static Optional<CombatantView> resolveTarget(
      CombatantView self, Decision decision, Percept percept) {
    if (decision.option() == com.shepherdjerred.thestorm.rwfbots.domain.world.Option.DEFUSE) {
      var immediate =
          percept
              .nearestVisible()
              .filter(enemy -> enemy.pos().distance(self.pos()) <= Reflex.REACH + 0.5);
      if (immediate.isPresent()) return immediate;
    }
    var decided = decision.target().flatMap(percept::visible);
    if (decided.isPresent()) {
      return decided;
    }
    var reach =
        switch (decision.stance()) {
          case AGGRESSIVE, CAUTIOUS -> Reflex.MELEE_ALERT;
          case STEALTH, EVASIVE -> Reflex.REACH;
        };
    return percept.nearestVisible().filter(enemy -> enemy.pos().distance(self.pos()) <= reach);
  }

  public ReflexInput withGapples(int count) {
    return new ReflexInput(self, snapshot, decision, target, count, perceived);
  }
}
