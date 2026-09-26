package com.shepherdjerred.thestorm.shops.domain.price;

/**
 * A shop price in whole crystals: at least one, at most {@link #MAX}.
 *
 * @param crystals the number of crystals
 */
public record Price(long crystals) implements Comparable<Price> {

  /** The highest price a sign or catalog may ask, so totals never overflow. */
  public static final long MAX = 1_000_000_000L;

  public Price {
    if (crystals < 1 || crystals > MAX) {
      throw new IllegalArgumentException("a price must be 1.." + MAX + " crystals: " + crystals);
    }
  }

  public static Price of(long crystals) {
    return new Price(crystals);
  }

  /** The price of {@code lots} trades at once. */
  public long times(int lots) {
    if (lots < 1) {
      throw new IllegalArgumentException("lots must be positive: " + lots);
    }
    return Math.multiplyExact(crystals, lots);
  }

  @Override
  public int compareTo(Price other) {
    return Long.compare(crystals, other.crystals);
  }
}
