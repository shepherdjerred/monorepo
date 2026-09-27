package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.time.Duration;

/**
 * A teleport refused because its cooldown has not run out.
 *
 * @param kind the teleport kind
 * @param remaining how long until it may be used again
 */
public record OnCooldown(TeleportKind kind, Duration remaining) {

  public OnCooldown {
    if (remaining.isNegative() || remaining.isZero()) {
      throw new IllegalArgumentException("remaining must be positive: " + remaining);
    }
  }
}
