package com.shepherdjerred.thestorm.essentials.domain.kit;

import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * One stack in a kit. The material and enchantment keys are checked against the server's registries
 * when the module starts.
 *
 * @param material the item's material, in modern upper-case form such as {@code IRON_SWORD}
 * @param amount how many, 1 to 64
 * @param name an optional display name (MiniMessage)
 * @param enchantments enchantment key (such as {@code sharpness}) to level
 */
public record KitItem(
    String material, int amount, Optional<String> name, Map<String, Integer> enchantments) {

  private static final Pattern MATERIAL = Pattern.compile("[A-Z][A-Z0-9_]*");
  private static final Pattern KEY = Pattern.compile("[a-z0-9_.-]+(:[a-z0-9_./-]+)?");

  public KitItem {
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
    enchantments = Map.copyOf(new TreeMap<>(enchantments));
  }
}
