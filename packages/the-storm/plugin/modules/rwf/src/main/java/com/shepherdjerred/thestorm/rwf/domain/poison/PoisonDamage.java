// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java,
// onPoison);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.poison;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.random.RandomGenerator;

/**
 * How much the poison hurts a player each second once it is deadly.
 *
 * <p>Each of the player's team's remaining bombs proposes {@code extra + random}: the random part
 * is up to one heart-point within {@link #NEAR} blocks of that bomb and up to half otherwise. The
 * largest proposal is dealt, scaled up for players with more than 20 max health. Red Warfare
 * computed this over the team's <em>own</em> bombs only, so a team whose bombs have all exploded
 * takes no poison damage at all; that quirk is kept and pinned by a test.
 */
public final class PoisonDamage {

  /** Damage every proposal starts from. */
  public static final double BASE = 0.75;

  /** Live time after which the base starts to climb. */
  public static final Duration RAMP_START = Duration.ofMinutes(11);

  /** The base climbs by one heart-point per this much live time past {@link #RAMP_START}. */
  public static final Duration RAMP_PERIOD = Duration.ofMinutes(2);

  /** Within this many blocks of an own bomb the random part is doubled. */
  public static final double NEAR = 15;

  public static final double NEAR_RANDOM = 1.0;
  public static final double FAR_RANDOM = 0.5;

  private PoisonDamage() {}

  /** The deterministic part of every proposal at {@code now}. */
  public static double extra(Instant liveSince, Instant now) {
    var past = Duration.between(liveSince, now).minus(RAMP_START).toMillis();
    return Math.max(0, past / (double) RAMP_PERIOD.toMillis()) + BASE;
  }

  /**
   * This second's damage to one player.
   *
   * @param target the player's position and max health
   * @param ownBombs the centres of the player's team's remaining bombs
   * @param extra {@link #extra}
   * @param random the match's random source; one draw per bomb
   */
  public static double amount(
      Target target, List<Vec3> ownBombs, double extra, RandomGenerator random) {
    var most = 0D;
    for (var bomb : ownBombs) {
      var near = bomb.distanceTo(target.position()) < NEAR;
      var proposal = extra + random.nextDouble() * (near ? NEAR_RANDOM : FAR_RANDOM);
      most = Math.max(most, proposal);
    }
    return most * Math.max(target.maxHealth(), 20) / 20;
  }

  /**
   * A player the poison may hurt.
   *
   * @param position where they stand
   * @param maxHealth their max health, 20 for an ordinary player
   */
  public record Target(Vec3 position, double maxHealth) {

    public Target {
      if (!(maxHealth > 0)) {
        throw new IllegalArgumentException("maxHealth must be positive: " + maxHealth);
      }
    }
  }
}
