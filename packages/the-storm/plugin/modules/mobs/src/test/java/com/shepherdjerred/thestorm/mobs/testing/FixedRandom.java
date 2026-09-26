package com.shepherdjerred.thestorm.mobs.testing;

import java.util.random.RandomGenerator;

/**
 * Randomness pinned to one point of every range: {@code at(0)} always picks the lowest value and
 * {@code at(0.999)} the highest.
 */
public final class FixedRandom implements RandomGenerator {

  private double point;

  private FixedRandom(double point) {
    this.point = point;
  }

  public static FixedRandom at(double point) {
    return new FixedRandom(check(point));
  }

  /** Pins every later draw to {@code point} instead. */
  public void moveTo(double point) {
    this.point = check(point);
  }

  private static double check(double point) {
    if (point < 0 || point >= 1) {
      throw new IllegalArgumentException("point must be in [0, 1)");
    }
    return point;
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
