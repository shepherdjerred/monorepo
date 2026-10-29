package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.SummonView;
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

  /** No bot without a shot stands closer than this to a hostile golem, in blocks. */
  public static final double GOLEM_KEEP_AWAY = 6;

  /** A bow takes on a hostile golem within this distance. */
  public static final double GOLEM_SHOT = 16;

  public ReflexInput {
    if (gapplesLeft < 0) {
      throw new IllegalArgumentException("gapples must not be negative");
    }
    perceived = List.copyOf(perceived);
  }

  /**
   * The input for {@code self} given what it perceives, with {@code gapplesLeft} apples: the
   * decided target when visible, otherwise only an enemy close enough to hit back at, the one that
   * just hurt the bot first, else a hostile killstreak creature ({@link #resolveSummon}). Whether
   * to fight anyone further away is the think step's call, so a bot holding its slot never charges.
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
    var reach = reach(decision);
    // Of the enemies in reach, the one that just hurt the bot comes first.
    var attacker =
        percept
            .state()
            .grudgeAt(percept.tick())
            .flatMap(grudge -> percept.visible(grudge.attacker()))
            .filter(enemy -> enemy.pos().distance(self.pos()) <= reach);
    if (attacker.isPresent()) {
      return attacker;
    }
    return percept
        .nearestVisible()
        .filter(enemy -> enemy.pos().distance(self.pos()) <= defended(self, decision, enemy, reach))
        .or(() -> resolveSummon(self, decision, percept).map(SummonView::asTarget));
  }

  /**
   * How close {@code enemy} may come before {@code self} fights it: {@code reach}, or for a bow kit
   * not running from the fight, a sword inside {@link BowSpacing#SWORD_NEAR}. It is shot as the
   * archer goes rather than met with its sword at arm's length.
   */
  private static double defended(
      CombatantView self, Decision decision, CombatantView enemy, double reach) {
    return self.kit().hasBow() && decision.stance() != Stance.EVASIVE && BowSpacing.sword(enemy)
        ? Math.max(reach, BowSpacing.SWORD_NEAR)
        : reach;
  }

  /**
   * The hostile killstreak creature {@code self} fights when no player needs it, if any: a dog in
   * the same reach a player would be fought at; a golem only with a bow, out of its reach and
   * within {@link #GOLEM_SHOT}, or to keep it in view and fend it off while the bot runs from it.
   * Of those, the one that just bit the bot comes first.
   */
  public static Optional<SummonView> resolveSummon(
      CombatantView self, Decision decision, Percept percept) {
    var fightable =
        percept.summons().stream().filter(summon -> fights(self, decision, summon)).toList();
    var attacker =
        percept
            .state()
            .grudgeAt(percept.tick())
            .flatMap(
                grudge ->
                    fightable.stream()
                        .filter(summon -> summon.id().equals(grudge.attacker()))
                        .findFirst());
    return attacker.or(() -> fightable.stream().findFirst());
  }

  private static boolean fights(CombatantView self, Decision decision, SummonView summon) {
    var distance = summon.pos().distance(self.pos());
    return switch (summon.kind()) {
      case WOLF -> distance <= reach(decision);
      case GOLEM ->
          (self.kit().hasBow() && distance > GOLEM_KEEP_AWAY && distance <= GOLEM_SHOT)
              || (decision.stance() == Stance.EVASIVE && distance <= GOLEM_KEEP_AWAY);
    };
  }

  private static double reach(Decision decision) {
    return switch (decision.stance()) {
      case AGGRESSIVE, CAUTIOUS -> Reflex.MELEE_ALERT;
      case STEALTH, EVASIVE -> Reflex.REACH;
    };
  }

  public ReflexInput withGapples(int count) {
    return new ReflexInput(self, snapshot, decision, target, count, perceived);
  }
}
