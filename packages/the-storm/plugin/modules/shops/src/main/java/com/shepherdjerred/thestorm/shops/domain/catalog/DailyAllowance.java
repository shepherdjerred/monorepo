package com.shepherdjerred.thestorm.shops.domain.catalog;

import java.time.Instant;
import java.time.ZoneId;

/**
 * How much of a daily limit a player has left today.
 *
 * @param limit items per day
 * @param used items already traded today in the same direction
 */
public record DailyAllowance(int limit, int used) {

  public DailyAllowance {
    if (limit < 1 || used < 0) {
      throw new IllegalArgumentException("limit must be positive and used not negative");
    }
  }

  public int remaining() {
    return Math.max(0, limit - used);
  }

  public boolean permits(int quantity) {
    return quantity <= remaining();
  }

  /** The most whole trades of {@code quantity} items still allowed today. */
  public int lotsLeft(int quantity) {
    if (quantity < 1) {
      throw new IllegalArgumentException("quantity must be positive: " + quantity);
    }
    return remaining() / quantity;
  }

  /** When the current day began in {@code zone}: limits reset at local midnight. */
  public static Instant dayStart(Instant now, ZoneId zone) {
    return now.atZone(zone).toLocalDate().atStartOfDay(zone).toInstant();
  }
}
