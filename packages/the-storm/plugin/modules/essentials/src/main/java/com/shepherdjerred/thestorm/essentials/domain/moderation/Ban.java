package com.shepherdjerred.thestorm.essentials.domain.moderation;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * A ban as replayed from the audit log.
 *
 * @param reason why
 * @param actor who banned the player
 * @param at when
 * @param expiresAt when it ends, or empty if permanent
 */
public record Ban(String reason, Actor actor, Instant at, Optional<Instant> expiresAt) {

  /** Whether it still applies at {@code now}: permanent, or ending strictly after now. */
  public boolean isActive(Instant now) {
    return expiresAt.isEmpty() || now.isBefore(expiresAt.orElseThrow());
  }

  /** Time left at {@code now}, or empty if permanent. */
  public Optional<Duration> remaining(Instant now) {
    return expiresAt.map(end -> now.isBefore(end) ? Duration.between(now, end) : Duration.ZERO);
  }
}
