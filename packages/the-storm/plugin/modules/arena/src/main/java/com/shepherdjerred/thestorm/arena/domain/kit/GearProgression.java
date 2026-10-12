package com.shepherdjerred.thestorm.arena.domain.kit;

import java.util.List;
import java.util.TreeMap;

/** Class gear grows from a cheap starter to the authored kit, then gains veteran enchantments. */
public final class GearProgression {
  private GearProgression() {}

  public static boolean equipment(ItemSpec item) {
    var material = item.material();
    return item.slot().isPresent()
        || material.endsWith("_SWORD")
        || material.endsWith("_AXE")
        || material.endsWith("_PICKAXE")
        || material.endsWith("_SPEAR")
        || material.equals("BOW")
        || material.equals("CROSSBOW")
        || material.equals("TRIDENT")
        || material.equals("MACE");
  }

  /** Consumables and class utility stay intact; only equipment changes. */
  public static ItemSpec at(ItemSpec item, int wave) {
    if (wave < 1) {
      throw new IllegalArgumentException("wave must be positive");
    }
    if (!equipment(item)) {
      return item;
    }
    var enchantments = new TreeMap<String, Integer>();
    item.enchantments().forEach((key, level) -> enchantments.put(key, level(key, level, wave)));
    return new ItemSpec(
        material(item.material(), wave),
        item.amount(),
        item.name(),
        enchantments,
        item.potion(),
        item.slot());
  }

  /** All templates must be validated before admission, including gear awarded much later. */
  public static List<ItemSpec> templates(ArenaClass kit) {
    return List.of(1, 6, 16, 31).stream()
        .flatMap(wave -> kit.items().stream().map(item -> at(item, wave)))
        .distinct()
        .toList();
  }

  private static int level(String key, int level, int wave) {
    if (wave < 6) {
      return 1;
    }
    if (wave < 16) {
      return Math.min(2, level);
    }
    if (wave >= 31
        && List.of("sharpness", "power", "protection", "smite", "impaling").contains(key)) {
      return Math.min(5, level + 1);
    }
    return level;
  }

  private static String material(String material, int wave) {
    if (wave >= 16) {
      return material;
    }
    for (var armor : List.of("HELMET", "CHESTPLATE", "LEGGINGS", "BOOTS")) {
      if (material.endsWith("_" + armor)) {
        return wave < 6
            ? "LEATHER_" + armor
            : material.replace("DIAMOND_", "IRON_").replace("NETHERITE_", "IRON_");
      }
    }
    for (var tool : List.of("SWORD", "AXE", "PICKAXE", "SPEAR")) {
      if (material.endsWith("_" + tool)) {
        return wave < 6
            ? "STONE_" + tool
            : material.replace("DIAMOND_", "IRON_").replace("NETHERITE_", "IRON_");
      }
    }
    return material;
  }
}
