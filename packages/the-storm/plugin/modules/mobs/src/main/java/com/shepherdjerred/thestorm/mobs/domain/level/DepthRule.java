package com.shepherdjerred.thestorm.mobs.domain.level;

/**
 * Extra levels underground, as in LevelledMobs' blended levelling that the 2023 revival tuned
 * (transition 62, period 5, multiplier 0.05): for every {@code period} blocks below {@code
 * transitionY} a mob gains {@code multiplier} times its distance level, rounded down. Mobs at or
 * above the transition gain nothing.
 *
 * @param transitionY the height where depth levels start
 * @param period how many blocks of depth make one step
 * @param multiplier the share of the distance level added per step
 */
public record DepthRule(int transitionY, int period, double multiplier) {

  public DepthRule {
    if (period < 1) {
      throw new IllegalArgumentException("period must be at least 1: " + period);
    }
    if (!(multiplier >= 0) || Double.isInfinite(multiplier)) {
      throw new IllegalArgumentException("multiplier must not be negative: " + multiplier);
    }
  }

  /** The levels a mob at height {@code y} with distance level {@code base} gains. */
  public int bonus(int y, int base) {
    if (y >= transitionY) {
      return 0;
    }
    var steps = (transitionY - y) / (double) period;
    return (int) Math.floor(steps * multiplier * base);
  }
}
