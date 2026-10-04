package com.shepherdjerred.thestorm.rwf.domain.kit;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * One stack of items in a kit. The adapter resolves materials and enchantments against the server's
 * registries when the module starts; the domain only keeps their names.
 *
 * @param material the material in modern upper-case form, such as {@code IRON_SWORD}
 * @param amount how many, 1 to 64
 * @param name an optional display name (plain text)
 * @param enchantments enchantment key (such as {@code sharpness}) to level
 * @param slot the armor slot it is worn in; empty for hotbar items
 */
public record ItemSpec(
    String material,
    int amount,
    Optional<String> name,
    Map<String, Integer> enchantments,
    Optional<ArmorSlot> slot) {

  private static final Pattern MATERIAL = Pattern.compile("[A-Z][A-Z0-9_]*");
  private static final Pattern KEY = Pattern.compile("[a-z0-9_.-]+");

  public ItemSpec {
    if (!MATERIAL.matcher(material).matches()) {
      throw new IllegalArgumentException("material must look like IRON_SWORD: " + material);
    }
    if (amount < 1 || amount > 64) {
      throw new IllegalArgumentException("amount must be 1-64: " + amount);
    }
    if (name.isPresent() && name.orElseThrow().isBlank()) {
      throw new IllegalArgumentException("name must not be blank");
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
    if (slot.isPresent() && amount != 1) {
      throw new IllegalArgumentException("armor must have amount 1: " + material);
    }
    enchantments = Map.copyOf(new TreeMap<>(enchantments));
  }

  public static ItemSpec of(String material) {
    return of(material, 1);
  }

  public static ItemSpec of(String material, int amount) {
    return new ItemSpec(material, amount, Optional.empty(), Map.of(), Optional.empty());
  }

  public static ItemSpec armor(String material, ArmorSlot slot) {
    return new ItemSpec(material, 1, Optional.empty(), Map.of(), Optional.of(slot));
  }

  public ItemSpec named(String displayName) {
    return new ItemSpec(material, amount, Optional.of(displayName), enchantments, slot);
  }

  public ItemSpec enchanted(String key, int level) {
    var next = new HashMap<>(enchantments);
    next.put(key, level);
    return new ItemSpec(material, amount, name, next, slot);
  }

  public int enchantmentLevel(String key) {
    return enchantments.getOrDefault(key, 0);
  }
}
