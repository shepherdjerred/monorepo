package com.shepherdjerred.thestorm.economy.app;

/**
 * An amount of crystals (CR), The Storm's currency. Whole crystals only; never negative.
 *
 * @param amount the number of crystals
 */
public record Crystals(long amount) implements Comparable<Crystals> {

  public static final Crystals ZERO = new Crystals(0);

  public Crystals {
    if (amount < 0) {
      throw new IllegalArgumentException("crystals must not be negative: " + amount);
    }
  }

  public static Crystals of(long amount) {
    return new Crystals(amount);
  }

  public Crystals plus(Crystals other) {
    return new Crystals(Math.addExact(amount, other.amount));
  }

  public boolean isAtLeast(Crystals other) {
    return amount >= other.amount;
  }

  @Override
  public int compareTo(Crystals other) {
    return Long.compare(amount, other.amount);
  }
}
