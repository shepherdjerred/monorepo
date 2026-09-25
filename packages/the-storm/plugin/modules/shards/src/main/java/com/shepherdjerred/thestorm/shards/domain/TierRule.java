package com.shepherdjerred.thestorm.shards.domain;

/**
 * What reaching one tier costs and risks. Whatever happens, the shards are spent.
 *
 * @param cost shards consumed by the attempt
 * @param failChance chance the storm fizzles: shards are spent and the item stays as it was
 * @param breakChance chance the storm destroys the item
 */
public record TierRule(int cost, double failChance, double breakChance) {

  public TierRule {
    if (cost < 1) {
      throw new IllegalArgumentException("cost must be at least 1 shard but was " + cost);
    }
    Checks.probability("failChance", failChance);
    Checks.probability("breakChance", breakChance);
    if (failChance + breakChance > 1) {
      throw new IllegalArgumentException(
          "failChance + breakChance must be at most 1 but was " + (failChance + breakChance));
    }
  }

  /** The chance the upgrade succeeds. */
  public double successChance() {
    return 1 - failChance - breakChance;
  }
}
