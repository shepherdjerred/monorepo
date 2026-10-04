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
 * One team's attempt to arm or defuse a bomb. It starts at ten seconds; every distinct clicker on
 * the team takes a second off, and so does each level of an applicable fuse bonus. The attempt
 * lapses when nobody on the team has clicked for more than {@link #CLICK_GAP}.
 *
 * @param team the team
 * @param action arming or defusing
 * @param startedAt the first click
 * @param lastClickAt the most recent click
 * @param secondsToFuse how long the attempt takes, which may be zero or negative (instant)
 * @param clickers everyone on the team who has clicked, in order
 */
public record ArmAttempt(
    TeamColor team,
    BombAction action,
    Instant startedAt,
    Instant lastClickAt,
    int secondsToFuse,
    List<CombatantId> clickers) {

  /** The arm or defuse time before anyone has clicked. */
  public static final int BASE_SECONDS = 10;

  /** Longer than this between clicks and the attempt is abandoned. */
  public static final Duration CLICK_GAP = Duration.ofMillis(750);

  public ArmAttempt {
    clickers = List.copyOf(clickers);
  }

  /** A fresh attempt by {@code team}; the first click is applied with {@link #click}. */
  static ArmAttempt begin(TeamColor team, BombAction action, Instant now) {
    return new ArmAttempt(team, action, now, now, BASE_SECONDS, List.of());
  }

  /** Registers a click. A clicker counts once; their fuse bonus counts with their first click. */
  ArmAttempt click(CombatantId clicker, Optional<FuseBonus> fuse, Instant now) {
    if (clickers.contains(clicker)) {
      return new ArmAttempt(team, action, startedAt, now, secondsToFuse, clickers);
    }
    var next = new ArrayList<>(clickers);
    next.add(clicker);
    var seconds = secondsToFuse - 1 - fuse.map(bonus -> bonus.secondsOff(action)).orElse(0);
    return new ArmAttempt(team, action, startedAt, now, seconds, next);
  }

  public Instant finishesAt() {
    return startedAt.plusSeconds(secondsToFuse);
  }

  /** Whether the team has clicked recently enough for the attempt to stand. */
  public boolean valid(Instant now) {
    return !now.isAfter(lastClickAt.plus(CLICK_GAP));
  }

  /** Whether the attempt has run its course at {@code now}. */
  public boolean finished(Instant now) {
    return now.isAfter(finishesAt());
  }

  /** How far along the attempt is, 0 to 1 (1 once finished). */
  public double progress(Instant now) {
    if (secondsToFuse <= 0 || finished(now)) {
      return 1;
    }
    var elapsed = Duration.between(startedAt, now).toMillis();
    return Math.max(0, elapsed / (1000D * secondsToFuse));
  }
}
