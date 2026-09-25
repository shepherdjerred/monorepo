package com.shepherdjerred.thestorm.shards.domain;

import java.util.List;
import java.util.Map;

/** Small, readable configs for the domain tests. */
final class Fixtures {

  static final String OVERWORLD = "minecraft:overworld";
  static final String NETHER = "minecraft:the_nether";

  private Fixtures() {}

  static DropsConfig drops() {
    return new DropsConfig(
        List.of(OVERWORLD, NETHER),
        List.of("SPAWNER", "SPAWNER_EGG"),
        Map.of("ZOMBIE", new DropRule(0.0005, 1, 1), "WARDEN", new DropRule(0.5, 1, 2)),
        Map.of(
            "DIAMOND_ORE", new DropRule(0.0075, 1, 2),
            "DEEPSLATE_DIAMOND_ORE", new DropRule(0.0075, 1, 2)));
  }

  static UpgradeConfig upgrades() {
    return new UpgradeConfig(
        List.of(
            new TierRule(1, 0.0, 0.0),
            new TierRule(2, 0.1, 0.0),
            new TierRule(4, 0.1, 0.0),
            new TierRule(6, 0.2, 0.05),
            new TierRule(10, 0.3, 0.1)),
        3,
        "<dark_aqua>Storm <tier>",
        1000);
  }

  static GearTable table(List<Double> bonus, String... materials) {
    return new GearTable(List.of(materials), bonus);
  }

  static final List<Double> WEAPON = List.of(0.05, 0.10, 0.15, 0.20, 0.25);

  static BonusConfig bonuses() {
    return new BonusConfig(
        0.4,
        0.2,
        new WeaponTables(
            table(WEAPON, "IRON_SWORD", "NETHERITE_SWORD"),
            table(WEAPON, "IRON_AXE"),
            table(List.of(0.03, 0.06, 0.09, 0.12, 0.15), "MACE"),
            table(WEAPON, "IRON_SPEAR"),
            table(WEAPON, "TRIDENT"),
            table(WEAPON, "BOW"),
            table(WEAPON, "CROSSBOW")),
        new ArmorTables(
            table(List.of(0.01, 0.02, 0.03, 0.04, 0.05), "IRON_HELMET"),
            table(List.of(0.03, 0.04, 0.05, 0.06, 0.07), "IRON_CHESTPLATE"),
            table(List.of(0.02, 0.03, 0.04, 0.05, 0.06), "IRON_LEGGINGS"),
            table(List.of(0.01, 0.02, 0.03, 0.04, 0.05), "IRON_BOOTS")));
  }

  static StormTier tier(int level) {
    return new StormTier(level);
  }
}
