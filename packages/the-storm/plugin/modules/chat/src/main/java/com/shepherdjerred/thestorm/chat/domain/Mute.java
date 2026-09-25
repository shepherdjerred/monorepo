package com.shepherdjerred.thestorm.chat.domain;

import java.time.Duration;
import java.time.Instant;

/**
 * A staff mute. The player cannot chat until {@code until}.
 *
 * @param until when the mute ends
 * @param reason why the player was muted, shown to them
 * @param issuer the name of the staff member who muted them
 */
public record Mute(Instant until, String reason, String issuer) {

  public Mute {
    if (reason.isBlank()) {
      throw new IllegalArgumentException("a mute needs a reason");
    }
    if (issuer.isBlank()) {
      throw new IllegalArgumentException("a mute needs an issuer");
    }
  }

  /** A mute starting at {@code now} and lasting {@code length}. */
  public static Mute starting(Instant now, Duration length, String reason, String issuer) {
    if (length.isNegative() || length.isZero()) {
      throw new IllegalArgumentException("a mute must last a positive time: " + length);
    }
    return new Mute(now.plus(length), reason, issuer);
  }

  /** Whether the mute still applies at {@code now}. */
  public boolean activeAt(Instant now) {
    return now.isBefore(until);
  }

  /** How long the mute has left at {@code now}; zero once it has ended. */
  public Duration remainingAt(Instant now) {
    return activeAt(now) ? Duration.between(now, until) : Duration.ZERO;
  }
}
