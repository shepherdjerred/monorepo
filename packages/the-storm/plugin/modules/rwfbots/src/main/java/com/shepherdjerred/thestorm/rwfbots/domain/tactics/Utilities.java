package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.EnumMap;

/**
 * The utility of every option, each in 0..1-ish, from the features, the bot's style, levers,
 * archetype and role. The rules of the game live here as curves: stacking on a fuse is worth a lot,
 * an own bomb with a lit fuse is worth everything, poison near the own bomb must be left, and the
 * appetite for fights grows as poison bites.
 *
 * <p>With no enemy close the playbook slot wins: the planter arms, everyone else takes and holds
 * their slot. Arming is only attractive to the bot holding the plant slot, a bot standing next to
 * an armable bomb with nobody around, or the last one alive. Swords fight up close; bows fight
 * inside their kit's band and hold their slot outside it.
 */
public final class Utilities {

  /** Options scoring under this are never planned. */
  public static final double FLOOR = 0.02;

  /** A sword fights an enemy about this close and holds its slot beyond. */
  static final double MELEE_ENGAGE = 7;

  /** An archer this close to its slot counts as there and fights at full range. */
  static final double ARCHER_AT_SLOT = 6;

  /** Only a bot this close to an armable bomb, with nobody near, arms without the plant slot. */
  static final double ARM_NEAR = 8;

  /** Besides the anchors, only bots this close to the own bomb answer a threat to it. */
  static final double RETAKE_RANGE = 16;

  /** Only escorts and bots this close come to stack on a teammate's fuse. */
  static final double HELP_RANGE = 15;

  /** Nobody known within this distance counts as safe to arm. */
  static final double ARM_SAFE = 12;

  private Utilities() {}

  /**
   * The bot's disposition.
   *
   * @param style its personality's style
   * @param aggression its aggression lever after difficulty shifts
   * @param role its current team role
   * @param bias its archetype's bias
   * @param keep the distance band it fights its kit at
   */
  public record Temper(
      Style style, double aggression, Role role, ArchetypeBias bias, ArchetypeBias.Range keep) {}

  public static EnumMap<Option, Double> score(Features f, Temper t) {
    var scores = new EnumMap<Option, Double>(Option.class);
    combat(f, t, scores);
    objectives(f, t, scores);
    positioning(f, t, scores);
    return scores;
  }

  private static void combat(Features f, Temper t, EnumMap<Option, Double> scores) {
    var push = t.aggression() * (1 + 0.5 * f.poisonIntensity());
    var fightReady = Curves.logistic(f.healthFrac(), 0.35, 8);
    var threatened = Curves.near(f.nearestEnemyDistance(), 8) * f.nearestEnemyConfidence();
    var lowHealth = 1 - Curves.logistic(f.healthFrac(), 0.5, 10);
    scores.put(Option.ENGAGE, engage(f, t, push, fightReady));
    scores.put(Option.RETREAT, threatened * lowHealth * (1.1 - 0.5 * t.aggression()));
    var safeToEat = 1 - Curves.near(f.nearestEnemyDistance(), 6) * f.nearestEnemyConfidence();
    scores.put(Option.HEAL, f.hasGapples() ? lowHealth * safeToEat : 0);
    scores.put(Option.REWIND, f.hasRewind() && f.rewindReady() ? threatened * lowHealth * 1.2 : 0);
    scores.put(Option.HUNT, hunt(f, t));
  }

  /** How much the bot wants to fight the nearest enemy it may take on. */
  static double engage(Features f, Temper t, double push, double fightReady) {
    var distance = f.nearestEnemyDistance();
    // An archer only opens a fight with an enemy it can see; a remembered one is the slot's
    // business (bounding towards it from cover).
    if (!Double.isFinite(distance) || (t.keep().ranged() && f.visibleEnemies() == 0)) {
      return 0;
    }
    var appetite = (0.5 + 0.5 * Math.min(1, push)) * fightReady * f.nearestEnemyConfidence();
    // An archer fights at full range from its slot; on the way there it only answers an enemy
    // inside the near edge of its band, so it does not stop to snipe from the doorway.
    var atSlot = !f.hasSlot() || f.slotDistance() <= ARCHER_AT_SLOT;
    var reach = atSlot ? t.keep().max() : t.keep().min();
    var inReach =
        t.keep().ranged()
            ? Curves.logistic(-distance, -(reach + 4), 0.5)
            : Curves.logistic(-distance, -MELEE_ENGAGE, 0.6);
    var crowded = f.freeTarget() ? 1 : Curves.near(distance, 4);
    var diving = t.bias().divesPastFights() && f.plantSlot() ? 0.4 : 1;
    return appetite * inReach * crowded * diving * t.bias().engage();
  }

  private static void objectives(Features f, Temper t, EnumMap<Option, Double> scores) {
    scores.put(Option.ARM, arm(f, t));
    scores.put(Option.HELP_ARM, helpArm(f, t));
    scores.put(Option.DEFUSE, f.ownBombLit() ? 1.0 : 0);
    var defender = t.role() == Role.DEFEND || t.role() == Role.RETAKE;
    var retake = defender ? 0.9 : f.ownBombDistance() < RETAKE_RANGE ? 0.5 : 0;
    scores.put(Option.RETAKE, f.enemyNearOwnBomb() && !f.ownBombLit() ? retake : 0);
    scores.put(Option.ESCAPE_POISON, f.inOwnBombPoisonZone() ? 1.2 : 0);
  }

  private static double helpArm(Features f, Temper t) {
    if (!f.allyArming() || f.enemyBombDistance() >= 40) {
      return 0;
    }
    var close = t.role() == Role.ESCORT || f.enemyBombDistance() < HELP_RANGE;
    return close ? 0.9 * t.bias().helpArm() : 0;
  }

  private static void positioning(Features f, Temper t, EnumMap<Option, Double> scores) {
    var quiet = f.knownEnemies() == 0;
    var holding = f.hasSlot() && f.slotDistance() <= Features.SLOT_RADIUS;
    var taking = f.hasSlot() && !holding && !f.plantSlot();
    // A planter waiting for the push holds its place on the line like anyone else.
    scores.put(
        Option.TAKE_SLOT, taking ? (0.45 + 0.15 * t.style().teamplay()) * t.bias().slot() : 0);
    scores.put(
        Option.HOLD_SLOT,
        holding && !f.plantSlot() ? (0.35 + 0.2 * t.style().patience()) * t.bias().slot() : 0);
    scores.put(Option.HOLD_ANGLE, quiet && !f.hasSlot() ? 0.1 : 0);
  }

  private static double arm(Features f, Temper t) {
    if (!Double.isFinite(f.enemyBombDistance())) {
      return 0;
    }
    var safe = 1 - 0.5 * Curves.near(f.nearestEnemyDistance(), 10) * f.nearestEnemyConfidence();
    if (f.livingAllies() == 0) {
      return 0.6 * safe + 0.25;
    }
    if (f.plantSlot()) {
      return (0.7 + 0.2 * t.style().risk()) * safe * t.bias().arm();
    }
    var nobodyNear = f.nearestEnemyDistance() > ARM_SAFE;
    return f.enemyBombDistance() <= ARM_NEAR && nobodyNear ? 0.75 * t.bias().arm() : 0;
  }

  private static double hunt(Features f, Temper t) {
    if (f.knownEnemies() == 0 || f.visibleEnemies() > 0) {
      return 0;
    }
    var enemyClose = Curves.near(f.nearestEnemyDistance(), 12) * f.nearestEnemyConfidence();
    var appetite = t.role() == Role.HUNT ? 0.45 + 0.3 * t.aggression() : 0.08 * t.aggression();
    return appetite * (1 - enemyClose) * t.bias().hunt();
  }
}
