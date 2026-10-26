package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.time.Duration;

/**
 * What a teleport costs right now. Nothing is recorded until the player arrives.
 *
 * @param kind the teleport kind
 * @param cost crystals to charge; zero means free
 * @param cooldown time before this kind can be used again, starting on arrival
 */
public record Quote(TeleportKind kind, long cost, Duration cooldown) {

  public Quote {
    if (cost < 0) {
      throw new IllegalArgumentException("cost must not be negative: " + cost);
    }
    if (cooldown.isNegative()) {
      throw new IllegalArgumentException("cooldown must not be negative: " + cooldown);
    }
  }
}
