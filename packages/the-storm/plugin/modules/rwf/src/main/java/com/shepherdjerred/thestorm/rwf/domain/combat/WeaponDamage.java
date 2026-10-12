// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/utils/UtilInv.java, getDamage);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.combat;

/**
 * The 1.8-style base damage of a held item, as Red Warfare applied it in place of the server's
 * attack damage: tier (wood 0, gold 0.5, stone 1, iron 2, diamond 3) plus tool kind (sword 4, axe
 * 3, pickaxe 2, shovel 1); anything that is not a tool deals 1.
 */
public final class WeaponDamage {

  private WeaponDamage() {}

  /** Base damage of {@code material}, in modern upper-case form such as {@code IRON_SWORD}. */
  public static double of(String material) {
    var kind = kind(material);
    return kind < 0 ? 1 : tier(material) + kind;
  }

  private static double tier(String material) {
    if (material.contains("DIAMOND_")) {
      return 3;
    }
    if (material.contains("IRON_")) {
      return 2;
    }
    if (material.contains("STONE_")) {
      return 1;
    }
    if (material.contains("GOLD_") || material.contains("GOLDEN_")) {
      return 0.5;
    }
    // Wood is 0; a material without a tier kept the original's default of 1.
    return material.contains("WOOD") ? 0 : 1;
  }

  /** The tool kind's damage, or -1 for something that is not a tool. */
  private static int kind(String material) {
    if (material.endsWith("_SWORD")) {
      return 4;
    }
    if (material.endsWith("_AXE")) {
      return 3;
    }
    if (material.endsWith("_PICKAXE")) {
      return 2;
    }
    if (material.endsWith("_SHOVEL") || material.endsWith("_SPADE")) {
      return 1;
    }
    return -1;
  }
}
