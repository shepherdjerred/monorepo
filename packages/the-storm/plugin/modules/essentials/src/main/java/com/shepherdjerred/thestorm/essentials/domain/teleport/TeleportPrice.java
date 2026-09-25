package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.time.Duration;

/**
 * The base price of one kind of teleport, before the usage multiplier.
 *
 * @param cost crystals charged at ×1; zero makes the teleport free
 * @param cooldown time before the next teleport of this kind at ×1
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
