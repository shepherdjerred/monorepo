package com.shepherdjerred.thestorm.essentials.domain.teleport;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;

/**
 * A price and cooldown multiplier, stored exactly in hundredths ({@code 150} is ×1.5). Never below
 * ×1: repeated use only ever makes teleports dearer, and time only brings them back to base.
 *
 * @param hundredths the multiplier times 100
 */
public record Multiplier(long hundredths) implements Comparable<Multiplier> {

  /** ×1, the base price. */
  public static final Multiplier ONE = new Multiplier(100);

  public Multiplier {
    if (hundredths < 100) {
      throw new IllegalArgumentException("a multiplier is at least x1: " + hundredths);
    }
  }

  /** The multiplier for a decimal factor such as {@code 1.5}, rounded to the nearest hundredth. */
  public static Multiplier of(double factor) {
    return new Multiplier(hundredthsOf(factor));
  }

  /** Converts a non-negative decimal step such as {@code 0.25} to hundredths. */
  public static long hundredthsOf(double value) {
    if (!Double.isFinite(value) || value < 0) {
      throw new IllegalArgumentException("must be a finite, non-negative number: " + value);
    }
    return BigDecimal.valueOf(value)
        .movePointRight(2)
        .setScale(0, RoundingMode.HALF_UP)
        .longValue();
  }

  /** This multiplier raised by {@code step} hundredths, but never above {@code cap}. */
  public Multiplier grow(long step, Multiplier cap) {
    return new Multiplier(Math.min(cap.hundredths, Math.addExact(hundredths, step)));
  }

  /** This multiplier lowered by {@code step} hundredths, but never below ×1. */
  public Multiplier shrink(long step) {
    return new Multiplier(Math.max(ONE.hundredths, hundredths - step));
  }

  /** {@code amount} times this multiplier, rounded up to a whole unit. */
  public long applyTo(long amount) {
    return Math.ceilDiv(Math.multiplyExact(amount, hundredths), 100L);
  }

  /** {@code duration} times this multiplier, to the millisecond. */
  public Duration applyTo(Duration duration) {
    return Duration.ofMillis(Math.multiplyExact(duration.toMillis(), hundredths) / 100L);
  }

  @Override
  public int compareTo(Multiplier other) {
    return Long.compare(hundredths, other.hundredths);
  }

  @Override
  public String toString() {
    return "x" + BigDecimal.valueOf(hundredths, 2).stripTrailingZeros().toPlainString();
  }
}
