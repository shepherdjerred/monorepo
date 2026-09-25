package com.shepherdjerred.thestorm.shards.domain;

import java.util.EnumMap;
import java.util.HashMap;
import java.util.Map;

/**
 * What upgraded gear does in combat.
 *
 * @param pvpMultiplier the share of every bonus that applies when the other side is a player
 *     ({@code 0.4} keeps 40%); bonuses apply in full against mobs
 * @param maxTotalReduction the most damage a full set of Storm armor can take away, below 1
 * @param weapons damage bonuses per weapon category
 * @param armor damage reductions per armor slot
 */
public record BonusConfig(
    double pvpMultiplier, double maxTotalReduction, WeaponTables weapons, ArmorTables armor) {

  public BonusConfig {
    Checks.probability("bonuses.pvpMultiplier", pvpMultiplier);
    Checks.probability("bonuses.maxTotalReduction", maxTotalReduction);
    if (maxTotalReduction >= 1) {
      throw new IllegalArgumentException(
          "bonuses.maxTotalReduction must be below 1, or Storm armor makes players immortal");
    }
    var owners = new HashMap<String, GearCategory>();
    for (var entry : tables(weapons, armor).entrySet()) {
      for (var material : entry.getValue().materials()) {
        var previous = owners.putIfAbsent(material, entry.getKey());
        if (previous != null) {
          throw new IllegalArgumentException(
              material + " is listed under both " + previous + " and " + entry.getKey());
        }
      }
    }
  }

  /** Every category's table. */
  public Map<GearCategory, GearTable> tables() {
    return tables(weapons, armor);
  }

  private static Map<GearCategory, GearTable> tables(WeaponTables weapons, ArmorTables armor) {
    var all = new EnumMap<GearCategory, GearTable>(GearCategory.class);
    all.putAll(weapons.byCategory());
    all.putAll(armor.byCategory());
    return all;
  }
}
