package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

/** Response curves that turn raw features into 0..1 desirabilities. */
public final class Curves {

  private Curves() {}

  public static double clamp01(double x) {
    return Math.clamp(x, 0, 1);
  }

  /** 0 at {@code from}, 1 at {@code to}, linear between; works with {@code from > to}. */
  public static double linear(double x, double from, double to) {
    return clamp01((x - from) / (to - from));
  }

  /** A logistic rising through 0.5 at {@code mid} with steepness {@code k} per unit. */
  public static double logistic(double x, double mid, double k) {
    return 1 / (1 + Math.exp(-k * (x - mid)));
  }

  /** 1 at zero distance falling to 0 at {@code range}, quadratically eased. */
  public static double near(double distance, double range) {
    var t = 1 - clamp01(distance / range);
    return t * t;
  }

  /** The smoothstep of {@code x} in 0..1. */
  public static double smooth(double x) {
    var t = clamp01(x);
    return t * t * (3 - 2 * t);
  }
}
