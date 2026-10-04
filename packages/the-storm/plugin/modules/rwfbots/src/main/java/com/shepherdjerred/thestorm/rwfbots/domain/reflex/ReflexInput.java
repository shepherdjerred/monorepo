package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.Optional;

/**
 * One tick's input to the reflex layer.
 *
 * @param self the bot's own view
 * @param snapshot the world
 * @param decision the standing decision from the think step
 * @param target the enemy to fight right now, if one is visible
 * @param gapplesLeft golden apples in the inventory
 */
public record ReflexInput(
    CombatantView self,
    WorldSnapshot snapshot,
    Decision decision,
    Optional<CombatantView> target,
    int gapplesLeft) {

  public ReflexInput {
    if (gapplesLeft < 0) {
      throw new IllegalArgumentException("gapples must not be negative");
    }
  }

  /**
   * The input for {@code self} given what it perceives, with {@code gapplesLeft} apples: the
   * decided target when visible, otherwise the nearest visible enemy unless the decision is to
   * avoid fights, in which case only an enemy already in reach is fought.
   */
  public static ReflexInput of(
      CombatantView self, WorldSnapshot snapshot, Decision decision, Percept percept) {
    return new ReflexInput(self, snapshot, decision, resolveTarget(self, decision, percept), 0);
  }

  /** The enemy {@code self} should fight this tick, if any. */
  public static Optional<CombatantView> resolveTarget(
      CombatantView self, Decision decision, Percept percept) {
    var decided = decision.target().flatMap(percept::visible);
    if (decided.isPresent()) {
      return decided;
    }
    return switch (decision.stance()) {
      case AGGRESSIVE, CAUTIOUS -> percept.nearestVisible();
      case STEALTH, EVASIVE ->
          percept
              .nearestVisible()
              .filter(enemy -> enemy.pos().distance(self.pos()) <= Reflex.REACH);
    };
  }

  public ReflexInput withGapples(int count) {
    return new ReflexInput(self, snapshot, decision, target, count);
  }
}
