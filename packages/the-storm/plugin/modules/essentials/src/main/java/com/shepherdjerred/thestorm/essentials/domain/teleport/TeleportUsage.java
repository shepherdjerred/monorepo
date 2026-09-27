package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.time.Instant;

/**
 * A player's history with one kind of teleport.
 *
 * @param multiplier the multiplier as of {@code lastUsed}, before any decay since
 * @param lastUsed when the player last took this kind of teleport
 * @param cooldownUntil the earliest instant the player may take it again
 */
public record TeleportUsage(Multiplier multiplier, Instant lastUsed, Instant cooldownUntil) {

  public TeleportUsage {
    if (cooldownUntil.isBefore(lastUsed)) {
      throw new IllegalArgumentException("a cooldown cannot end before the teleport it follows");
    }
  }
}
