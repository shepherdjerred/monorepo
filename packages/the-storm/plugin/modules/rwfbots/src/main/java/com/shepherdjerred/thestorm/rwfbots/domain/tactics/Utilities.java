package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.EnumMap;

/**
 * The utility of every option, each in 0..1-ish, from the features, the bot's style and levers, and
 * its role. The rules of the game live here as curves: stacking on a fuse is worth a lot, an own
 * bomb with a lit fuse is worth everything, poison near the own bomb must be left, and the appetite
 * for fights grows as poison bites.
 */
public final class Utilities {

  /** Options scoring under this are never planned. */
  public static final double FLOOR = 0.02;

  private Utilities() {}

  /**
   * The bot's disposition.
   *
   * @param style its personality's style
   * @param aggression its aggression lever after difficulty shifts
   * @param role its current team role
   */
  public record Temper(Style style, double aggression, Role role) {}

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
    var enemyNear = Curves.near(f.nearestEnemyDistance(), 40) * f.nearestEnemyConfidence();
    var threatened = Curves.near(f.nearestEnemyDistance(), 8) * f.nearestEnemyConfidence();
    var lowHealth = 1 - Curves.logistic(f.healthFrac(), 0.5, 10);
    scores.put(Option.ENGAGE, enemyNear * fightReady * (0.4 + 0.6 * push));
    scores.put(Option.RETREAT, threatened * lowHealth * (1.1 - 0.5 * t.aggression()));
    var safeToEat = 1 - Curves.near(f.nearestEnemyDistance(), 6) * f.nearestEnemyConfidence();
    scores.put(Option.HEAL, f.hasGapples() ? lowHealth * safeToEat : 0);
    scores.put(Option.REWIND, f.hasRewind() ? threatened * lowHealth * 1.1 : 0);
    scores.put(Option.HUNT, hunt(f, t));
  }

  private static void objectives(Features f, Temper t, EnumMap<Option, Double> scores) {
    scores.put(Option.ARM, arm(f, t));
    scores.put(Option.HELP_ARM, f.allyArming() && f.enemyBombDistance() < 40 ? 0.9 : 0);
    scores.put(Option.DEFUSE, f.ownBombLit() ? 1.0 : 0);
    var retakeRole = t.role() == Role.DEFEND || t.role() == Role.RETAKE ? 0.3 : 0;
    scores.put(Option.RETAKE, f.enemyNearOwnBomb() && !f.ownBombLit() ? 0.6 + retakeRole : 0);
    scores.put(Option.ESCAPE_POISON, f.inOwnBombPoisonZone() ? 1.2 : 0);
  }

  private static void positioning(Features f, Temper t, EnumMap<Option, Double> scores) {
    var quiet = f.knownEnemies() == 0;
    var patience = t.style().patience();
    scores.put(Option.GUARD_CHOKE, t.role() == Role.DEFEND && quiet ? 0.3 + 0.4 * patience : 0);
    scores.put(Option.HOLD_ANGLE, quiet ? 0.1 + 0.3 * patience * (1 - t.aggression()) : 0);
    scores.put(Option.ROTATE, t.role() == Role.ROTATE ? 0.35 : quiet ? 0.15 : 0);
    var escorting = t.role() == Role.ESCORT && f.livingAllies() > 0;
    scores.put(Option.ESCORT, escorting ? 0.55 * (0.5 + t.style().teamplay() / 2) : 0);
  }

  private static double arm(Features f, Temper t) {
    if (!Double.isFinite(f.enemyBombDistance())) {
      return 0;
    }
    var proximity = 0.3 + 0.7 * Curves.near(f.enemyBombDistance(), 120);
    var roleBoost = t.role() == Role.PLANT ? 1.0 : 0.6;
    var lastMan = f.livingAllies() == 0 ? 0.25 : 0;
    var safe = 1 - 0.5 * Curves.near(f.nearestEnemyDistance(), 10) * f.nearestEnemyConfidence();
    return (0.5 + 0.3 * t.style().risk()) * proximity * roleBoost * safe + lastMan;
  }

  private static double hunt(Features f, Temper t) {
    if (f.knownEnemies() == 0) {
      return t.role() == Role.HUNT ? 0.35 + 0.3 * t.aggression() : 0.1 * t.aggression();
    }
    var enemyClose = Curves.near(f.nearestEnemyDistance(), 12) * f.nearestEnemyConfidence();
    var remembered = f.visibleEnemies() == 0 ? 0.3 + 0.3 * t.aggression() : 0;
    return remembered * (1 - enemyClose) + (t.role() == Role.HUNT ? 0.15 : 0);
  }
}
