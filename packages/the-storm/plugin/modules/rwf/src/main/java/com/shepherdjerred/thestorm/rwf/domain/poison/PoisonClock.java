// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java,
// onPoison);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.poison;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * The timer that forces a long match to a result. It starts at ten minutes; every second in which
 * nobody has died for ninety seconds takes a further three seconds off. When it runs out players
 * are warned, and a minute later their food is taken and the poison deals damage every second.
 *
 * <p>Ticked once a second, as the original was.
 *
 * @param stage how far the poison has got
 * @param deathTimer how long after going live the warning comes (or came)
 * @param liveSince when the match went live
 * @param lastDeath when someone last died; the live time until then
 */
public record PoisonClock(Stage stage, Duration deathTimer, Instant liveSince, Instant lastDeath) {

  public static final Duration INITIAL = Duration.ofMinutes(10);

  /** Seconds without a death before the timer hastens. */
  public static final Duration QUIET = Duration.ofSeconds(90);

  /** How much each quiet second takes off the timer. */
  public static final Duration HASTEN = Duration.ofSeconds(3);

  /** From the warning to the first damage. */
  public static final Duration GRACE = Duration.ofMinutes(1);

  /** Where the poison is. */
  public enum Stage {
    /** Counting down to the warning. */
    WAITING,
    /** "One minute until players start dying!" */
    WARNED,
    /** Food is gone and every second hurts. */
    DEADLY,
  }

  /** What a second of the clock told the match to do. */
  public enum Notice {
    /** Announce "One minute until players start dying!". */
    WARNING,
    /** Announce "Don't say I didn't warn you!" and take everyone's golden apples and steak. */
    BEGUN,
    /** Deal this second's poison damage. */
    DAMAGE,
  }

  /** The clock as the match goes live. */
  public static PoisonClock start(Instant liveSince) {
    return new PoisonClock(Stage.WAITING, INITIAL, liveSince, liveSince);
  }

  /** Someone died. */
  public PoisonClock deathAt(Instant now) {
    return new PoisonClock(stage, deathTimer, liveSince, now);
  }

  /** Whether the poison has started hurting, or will at this instant. */
  public boolean endGame(Instant now) {
    return now.isAfter(liveSince.plus(deathTimer).plus(GRACE));
  }

  /** How long until the poison starts hurting; zero once it has. */
  public Duration untilPoison(Instant now) {
    var until = Duration.between(now, liveSince.plus(deathTimer).plus(GRACE));
    return until.isNegative() ? Duration.ZERO : until;
  }

  /** A second passed. */
  public Step tick(Instant now) {
    var timer = deathTimer;
    if (stage == Stage.WAITING && !elapsed(now, timer)) {
      if (now.isAfter(lastDeath.plus(QUIET))) {
        timer = timer.minus(HASTEN);
      }
    }
    if (stage == Stage.WAITING && elapsed(now, timer)) {
      var warned =
          new PoisonClock(Stage.WARNED, Duration.between(liveSince, now), liveSince, lastDeath);
      return new Step(warned, List.of(Notice.WARNING));
    }
    var next = new PoisonClock(stage, timer, liveSince, lastDeath);
    if (stage != Stage.WAITING && next.endGame(now)) {
      if (stage == Stage.WARNED) {
        var deadly = new PoisonClock(Stage.DEADLY, timer, liveSince, lastDeath);
        return new Step(deadly, List.of(Notice.BEGUN, Notice.DAMAGE));
      }
      return new Step(next, List.of(Notice.DAMAGE));
    }
    return new Step(next, List.of());
  }

  private boolean elapsed(Instant now, Duration timer) {
    return now.isAfter(liveSince.plus(timer));
  }

  /**
   * A second's outcome.
   *
   * @param clock the clock afterwards
   * @param notices what the match must do
   */
  public record Step(PoisonClock clock, List<Notice> notices) {

    public Step {
      notices = List.copyOf(notices);
    }
  }
}
