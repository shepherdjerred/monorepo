package com.shepherdjerred.thestorm.shards.domain;

import java.util.List;

/**
 * One gear category's items and per-tier bonus.
 *
 * @param materials the Paper item materials in this category
 * @param bonus the bonus per tier, Storm I first, as a fraction: for weapons extra damage dealt
 *     ({@code 0.10} is +10%), for armor damage taken away ({@code 0.03} is -3%). Never decreases
 *     from one tier to the next.
 */
public record GearTable(List<String> materials, List<Double> bonus) {

  public GearTable {
    materials = List.copyOf(materials);
    bonus = List.copyOf(bonus);
    Checks.notEmpty("materials", materials);
    Checks.unique("materials", materials);
    materials.forEach(material -> Checks.constant("materials", material));
    Checks.perTier("bonus", bonus);
    var previous = 0.0;
    for (var value : bonus) {
      Checks.probability("bonus", value);
      if (value < previous) {
        throw new IllegalArgumentException("bonus must not decrease between tiers: " + bonus);
      }
      previous = value;
    }
  }

  /** The bonus at {@code tier}. */
  public double at(StormTier tier) {
    return bonus.get(tier.index());
  }
}
