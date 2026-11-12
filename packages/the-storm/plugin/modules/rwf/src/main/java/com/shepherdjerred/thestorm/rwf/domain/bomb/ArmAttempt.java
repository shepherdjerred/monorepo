// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/TeamBomb.java, ArmInfo);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.bomb;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * One team's attempt to arm or defuse a bomb. It starts at ten seconds; every distinct person on
 * the team takes a second off, and so does each level of an applicable fuse bonus. Holding
 * right-click earns that clock one second per second. A tap earns {@link #TAP_CREDIT}. The attempt
 * lapses when nobody on the team has held or tapped for more than {@link #CLICK_GAP}.
 *
 * @param team the team
 * @param action arming or defusing
 * @param startedAt the first input
 * @param lastInputAt the most recent tap or hold sample
 * @param secondsToFuse how long a hold takes, which may be zero or negative (instant)
 * @param clickers everyone on the team who has tapped or held, in order
 * @param credit seconds of the clock already earned, not counting a hold still in progress
 * @param holding whether the latest input was a hold, so time since {@code lastInputAt} still
 *     counts
 */
public record ArmAttempt(
    TeamColor team,
    BombAction action,
    Instant startedAt,
    Instant lastInputAt,
    int secondsToFuse,
    List<CombatantId> clickers,
    double credit,
    boolean holding) {

  /** The arm or defuse time before anyone has worked it. */
  public static final int BASE_SECONDS = 10;

  /** Longer than this between inputs and the attempt is abandoned. */
  public static final Duration CLICK_GAP = Duration.ofMillis(750);

  /** What one tap adds to the clock. A hold adds the time it is actually held. */
  public static final Duration TAP_CREDIT = Duration.ofMillis(200);

  public ArmAttempt {
    clickers = List.copyOf(clickers);
    if (Double.isNaN(credit) || credit < 0) {
      throw new IllegalArgumentException("credit must be a non-negative number of seconds");
    }
  }

  /**
   * A fresh attempt by {@code team}; the first input is applied with {@link #tap} or {@link #hold}.
   */
  static ArmAttempt begin(TeamColor team, BombAction action, Instant now) {
    return new ArmAttempt(team, action, now, now, BASE_SECONDS, List.of(), 0, false);
  }

  /** Registers a tap. A person counts once; their fuse bonus counts with their first input. */
  ArmAttempt tap(CombatantId clicker, Optional<FuseBonus> fuse, Instant now) {
    return admit(clicker, fuse).add(TAP_CREDIT.toMillis() / 1000D, now, false);
  }

  /**
   * Registers a hold sample. The first sample starts the clock; each later sample, while the
   * previous input was also a hold, adds the time since that sample.
   */
  ArmAttempt hold(CombatantId clicker, Optional<FuseBonus> fuse, Instant now) {
    var admitted = admit(clicker, fuse);
    var elapsed =
        admitted.holding()
            ? Math.max(0, Duration.between(admitted.lastInputAt(), now).toMillis() / 1000D)
            : 0;
    return admitted.add(elapsed, now, true);
  }

  private ArmAttempt admit(CombatantId clicker, Optional<FuseBonus> fuse) {
    if (clickers.contains(clicker)) {
      return this;
    }
    var next = new ArrayList<>(clickers);
    next.add(clicker);
    var seconds = secondsToFuse - 1 - fuse.map(bonus -> bonus.secondsOff(action)).orElse(0);
    return new ArmAttempt(team, action, startedAt, lastInputAt, seconds, next, credit, holding);
  }

  private ArmAttempt add(double seconds, Instant now, boolean nowHolding) {
    return new ArmAttempt(
        team, action, startedAt, now, secondsToFuse, clickers, credit + seconds, nowHolding);
  }

  /** When a hold in progress would finish. A tap-only attempt has no fast projection. */
  public Instant finishesAt() {
    if (secondsToFuse <= 0) {
      return startedAt;
    }
    var remaining = secondsToFuse - credit;
    if (remaining <= 0) {
      return lastInputAt;
    }
    if (!holding) {
      var taps = Math.ceil(remaining / (TAP_CREDIT.toMillis() / 1000D));
      return lastInputAt.plusMillis((long) (taps * CLICK_GAP.toMillis()));
    }
    return lastInputAt.plusMillis((long) Math.ceil(remaining * 1000D));
  }

  /** Whether the team has tapped or held recently enough for the attempt to stand. */
  public boolean valid(Instant now) {
    return !now.isAfter(lastInputAt.plus(CLICK_GAP));
  }

  /** Whether the attempt has earned its clock at {@code now}. */
  public boolean finished(Instant now) {
    return secondsToFuse <= 0 || earned(now) + 1e-9 >= secondsToFuse;
  }

  /** How far along the attempt is, 0 to 1 (1 once finished). */
  public double progress(Instant now) {
    if (secondsToFuse <= 0 || finished(now)) {
      return 1;
    }
    return Math.max(0, earned(now) / secondsToFuse);
  }

  /** Seconds earned by {@code now}, including a hold that is still down. */
  double earned(Instant now) {
    if (!holding || now.isBefore(lastInputAt) || !valid(now)) {
      return credit;
    }
    return credit + Duration.between(lastInputAt, now).toMillis() / 1000D;
  }
}
