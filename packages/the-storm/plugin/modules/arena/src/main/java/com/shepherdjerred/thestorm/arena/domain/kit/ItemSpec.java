package com.shepherdjerred.thestorm.arena.domain.kit;

import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * One stack of items in a kit, an upgrade or a loot table. Materials, enchantments and potions are
 * checked against the server's registries when the module starts.
 *
 * @param material the item's material, in modern upper-case form such as {@code IRON_SWORD}
 * @param amount how many, 1 to 64
 * @param name an optional display name (plain text)
 * @param enchantments enchantment key (such as {@code sharpness}) to level
 * @param potion the potion type key (such as {@code strong_healing}) for potions and tipped arrows
 * @param slot where to put it; none means anywhere in the inventory
 */
public record ItemSpec(
    String material,
    int amount,
    Optional<String> name,
    Map<String, Integer> enchantments,
    Optional<String> potion,
    Optional<Slot> slot) {

  private static final Pattern MATERIAL = Pattern.compile("[A-Z][A-Z0-9_]*");
  private static final Pattern KEY = Pattern.compile("[a-z0-9_.-]+(:[a-z0-9_./-]+)?");

  public ItemSpec {
    if (!MATERIAL.matcher(material).matches()) {
      throw new IllegalArgumentException("material must look like IRON_SWORD: " + material);
    }
    if (amount < 1 || amount > 64) {
      throw new IllegalArgumentException("amount must be 1-64: " + amount);
    }
    if (name.isPresent() && name.orElseThrow().isBlank()) {
      throw new IllegalArgumentException("name must not be blank; use null for none");
    }
    for (var enchantment : enchantments.entrySet()) {
      if (!KEY.matcher(enchantment.getKey()).matches()) {
        throw new IllegalArgumentException("invalid enchantment key: " + enchantment.getKey());
      }
      if (enchantment.getValue() < 1 || enchantment.getValue() > 255) {
        throw new IllegalArgumentException(
            "enchantment level must be 1-255: " + enchantment.getKey());
      }
    }
    if (potion.isPresent() && !KEY.matcher(potion.orElseThrow()).matches()) {
      throw new IllegalArgumentException("invalid potion key: " + potion.orElseThrow());
    }
    if (potion.isPresent() && !isPotionCarrier(material)) {
      throw new IllegalArgumentException(
          material
              + " cannot hold a potion; use POTION, SPLASH_POTION, LINGERING_POTION"
              + " or TIPPED_ARROW");
    }
    if (slot.isPresent() && amount != 1) {
      throw new IllegalArgumentException("equipment in a slot must have amount 1: " + material);
    }
    enchantments = Map.copyOf(new TreeMap<>(enchantments));
  }

  private static boolean isPotionCarrier(String material) {
    return switch (material) {
      case "POTION", "SPLASH_POTION", "LINGERING_POTION", "TIPPED_ARROW" -> true;
      default -> false;
    };
  }
}
