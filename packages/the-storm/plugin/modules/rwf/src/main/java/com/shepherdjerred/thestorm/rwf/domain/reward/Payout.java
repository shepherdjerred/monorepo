// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java,
// getCreditsWin/Lose/Kill, and
// redwarfare-arcade/src/me/libraryaddict/arcade/managers/WinManager.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.reward;

/**
 * Credits for a match. Red Warfare paid 3 for a win, 1 for a loss and nothing per kill. Here the
 * base is scaled by how many of the combatants were human: a match with no humans but you pays a
 * quarter, a full human match pays in full.
 */
public final class Payout {

  public static final int WIN = 3;
  public static final int LOSE = 1;
  public static final int KILL = 0;

  /** The share of the base paid when no other combatant is human. */
  public static final double FLOOR = 0.25;

  private Payout() {}

  /**
   * {@code round(base × (0.25 + 0.75 × humanShare))}.
   *
   * @param base the unscaled credits
   * @param humanShare the fraction of combatants who were human, 0 to 1
   */
  public static long scale(int base, double humanShare) {
    if (base < 0) {
      throw new IllegalArgumentException("base must not be negative: " + base);
    }
    if (!(humanShare >= 0 && humanShare <= 1)) {
      throw new IllegalArgumentException("humanShare must be 0-1: " + humanShare);
    }
    return Math.round(base * (FLOOR + (1 - FLOOR) * humanShare));
  }

  /** The human fraction of a roster. */
  public static double humanShare(int humans, int combatants) {
    if (combatants <= 0 || humans < 0 || humans > combatants) {
      throw new IllegalArgumentException("need 0 <= humans <= combatants, combatants > 0");
    }
    return humans / (double) combatants;
  }
}
