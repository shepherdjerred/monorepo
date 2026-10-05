package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.time.Duration;

/**
 * The base price of one kind of teleport, before the usage multiplier.
 *
 * @param cost crystals charged at ×1; zero makes the teleport free
 * @param cooldown time before the next teleport of this kind at ×1
 */
public record TeleportPrice(long cost, Duration cooldown, double weight) {

  public TeleportPrice {
    if (cost < 0) {
      throw new IllegalArgumentException("cost must not be negative: " + cost);
    }
    if (cooldown.isNegative()) {
      throw new IllegalArgumentException("cooldown must not be negative: " + cooldown);
    }
    if (!Double.isFinite(weight)
        || weight <= 0
        || weight * 2 != Math.rint(weight * 2)
        || weight > Integer.MAX_VALUE / 2.0) {
      throw new IllegalArgumentException("weight must be a positive multiple of half a point");
    }
  }

  /** Integer half-points avoid rounding in the shared allowance. */
  public int halfPoints() {
    return (int) (weight * 2);
  }
}
