package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.time.Duration;

/**
 * The price of one kind of teleport.
 *
 * @param cost crystals charged; zero makes the teleport free
 * @param cooldown time before the next teleport of this kind
 */
public record TeleportPrice(long cost, Duration cooldown) {

  public TeleportPrice {
    if (cost < 0) {
      throw new IllegalArgumentException("cost must not be negative: " + cost);
    }
    if (cooldown.isNegative()) {
      throw new IllegalArgumentException("cooldown must not be negative: " + cooldown);
    }
  }
}
