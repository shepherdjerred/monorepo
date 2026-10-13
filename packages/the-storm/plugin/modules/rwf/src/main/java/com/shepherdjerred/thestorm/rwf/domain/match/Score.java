// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/Game.java, giveKillstreak, and
// redwarfare-arcade/src/me/libraryaddict/arcade/managers/GameStatsManager.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

/**
 * A combatant's tally in one match.
 *
 * @param kills deaths credited to them as the killer
 * @param assists deaths they shared in without the kill (more than {@code DamageLog.STOLEN_SHARE}
 *     of the damage)
 * @param killstreak killstreak progress: one per kill plus each assist's share of the damage, as
 *     Red Warfare counted it; killstreak rewards read whole steps of this
 */
public record Score(int kills, int assists, double killstreak) {

  public static final Score ZERO = new Score(0, 0, 0);

  public Score {
    if (kills < 0 || assists < 0 || !(killstreak >= 0) || !Double.isFinite(killstreak)) {
      throw new IllegalArgumentException("a score never goes negative");
    }
  }

  /** One more kill: a whole step of killstreak. */
  Score kill() {
    return new Score(kills + 1, assists, killstreak + 1);
  }

  /** A share of someone else's kill; it counts as an assist above the stolen-kill threshold. */
  Score assist(double share, boolean counts) {
    return new Score(kills, assists + (counts ? 1 : 0), killstreak + share);
  }

  /** The whole killstreak steps reached. */
  public int streak() {
    return (int) Math.floor(killstreak);
  }
}
