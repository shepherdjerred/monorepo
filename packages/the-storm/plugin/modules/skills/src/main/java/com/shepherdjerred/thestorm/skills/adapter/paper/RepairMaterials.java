package com.shepherdjerred.thestorm.skills.adapter.paper;

import java.util.Optional;
import org.bukkit.Material;

/** Deliberately narrow blacksmith repair set: tools and weapons only. */
final class RepairMaterials {

  private RepairMaterials() {}

  static Optional<Material> ingredient(Material tool) {
    String name = tool.name();
    if (!toolLike(name)) {
      return Optional.empty();
    }
    if (name.startsWith("IRON_")) {
      return Optional.of(Material.IRON_INGOT);
    }
    if (name.startsWith("DIAMOND_")) {
      return Optional.of(Material.DIAMOND);
    }
    if (name.startsWith("NETHERITE_")) {
      return Optional.of(Material.NETHERITE_INGOT);
    }
    if (name.startsWith("GOLDEN_")) {
      return Optional.of(Material.GOLD_INGOT);
    }
    if (name.startsWith("STONE_")) {
      return Optional.of(Material.COBBLESTONE);
    }
    return Optional.empty();
  }

  private static boolean toolLike(String name) {
    return name.endsWith("_PICKAXE")
        || name.endsWith("_AXE")
        || name.endsWith("_SHOVEL")
        || name.endsWith("_HOE")
        || name.endsWith("_SWORD");
  }
}
