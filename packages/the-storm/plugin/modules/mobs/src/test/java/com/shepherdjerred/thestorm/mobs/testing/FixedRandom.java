package com.shepherdjerred.thestorm.mobs.testing;

import java.util.random.RandomGenerator;

/**
 * Randomness pinned to one point of every range: {@code at(0)} always picks the lowest value and
 * {@code at(0.999)} the highest.
 */
public final class FixedRandom implements RandomGenerator {

  private final double point;

  private FixedRandom(double point) {
    this.point = point;
  }

  public static FixedRandom at(double point) {
    if (point < 0 || point >= 1) {
      throw new IllegalArgumentException("point must be in [0, 1)");
    }
    return new FixedRandom(point);
  }

  public static FixedRandom lowest() {
    return at(0);
  }

  public static FixedRandom highest() {
    return at(0.999_999);
  }

  @Override
  public long nextLong() {
    return (long) (point * Long.MAX_VALUE);
  }

  @Override
  public int nextInt(int origin, int bound) {
    return origin + (int) Math.floor((bound - origin) * point);
  }

  @Override
  public double nextDouble() {
    return point;
  }
}
