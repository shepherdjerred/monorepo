package com.shepherdjerred.thestorm.shops.domain.trade;

/**
 * How many items of a shop's listed lot can actually move, and what that smaller lot costs. The
 * price scales with the items and stays at least one crystal.
 */
public final class PartialQuantity {

  private PartialQuantity() {}

  /** How many of {@code asked} fit in {@code available} stock and {@code room}. */
  public static int fit(int asked, int available, int room) {
    if (asked < 1) {
      throw new IllegalArgumentException("asked must be positive: " + asked);
    }
    return Math.max(0, Math.min(asked, Math.min(Math.max(0, available), Math.max(0, room))));
  }

  /** The price of {@code taken} items when {@code asked} items cost {@code price}. */
  public static long scale(long price, int asked, int taken) {
    if (price < 1 || asked < 1 || taken < 1 || taken > asked) {
      throw new IllegalArgumentException(
          "cannot scale " + price + " for " + taken + " of " + asked);
    }
    if (taken == asked) {
      return price;
    }
    return Math.max(1, Math.multiplyExact(price, taken) / asked);
  }
}
