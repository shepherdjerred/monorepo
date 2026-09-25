package com.shepherdjerred.thestorm.essentials.domain.afk;

import java.time.Duration;
import java.time.Instant;

/**
 * Whether a player is away, and when they last did something. Immutable; each transition returns
 * the next state.
 *
 * @param lastActivity when the player last moved, chatted or acted
 * @param afk whether the player is marked away
 */
public record AfkState(Instant lastActivity, boolean afk) {

  /** A player who just joined: active, not away. */
  public static AfkState joined(Instant now) {
    return new AfkState(now, false);
  }

  /** The player did something: they are active and no longer away. */
  public AfkState active(Instant now) {
    return new AfkState(now, false);
  }

  /** {@code /afk}: marks the player away, or back if they already were. */
  public AfkState toggle(Instant now) {
    return new AfkState(now, !afk);
  }

  /** The periodic check: marks the player away once idle for at least {@code timeout}. */
  public AfkState idleCheck(Duration timeout, Instant now) {
    if (afk || Duration.between(lastActivity, now).compareTo(timeout) < 0) {
      return this;
    }
    return new AfkState(lastActivity, true);
  }
}
