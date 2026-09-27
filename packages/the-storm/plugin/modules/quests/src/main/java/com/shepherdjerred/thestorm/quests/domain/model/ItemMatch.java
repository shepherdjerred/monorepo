package com.shepherdjerred.thestorm.quests.domain.model;

import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * Which items count: a material, and optionally a custom name, minimum enchantment levels and a
 * potion type. An item matches when it has the material and at least everything listed; other
 * components are ignored.
 *
 * @param material a material name, such as {@code IRON_INGOT}
 * @param name the item's custom name as plain text, if it must have one
 * @param enchantments enchantment keys (such as {@code sharpness}) and their minimum levels
 * @param potion the potion type key (such as {@code strong_healing}), if it must be a potion of it
 */
public record ItemMatch(
    String material,
    Optional<String> name,
    Map<String, Integer> enchantments,
    Optional<String> potion) {

  /** Material and entity names: upper-case words joined by underscores. */
  public static final Pattern MATERIAL = Pattern.compile("[A-Z][A-Z0-9_]*");

  /** Enchantment and potion keys: lower-case words joined by underscores. */
  public static final Pattern KEY = Pattern.compile("[a-z][a-z0-9_]*");

  public ItemMatch {
    if (!MATERIAL.matcher(material).matches()) {
      throw new IllegalArgumentException("materials are upper-case names: " + material);
    }
    enchantments = Map.copyOf(new TreeMap<>(enchantments));
    for (var entry : enchantments.entrySet()) {
      if (!KEY.matcher(entry.getKey()).matches() || entry.getValue() < 1) {
        throw new IllegalArgumentException(
            "enchantments are key:level with level >= 1: " + entry.getKey());
      }
    }
    potion.ifPresent(
        key -> {
          if (!KEY.matcher(key).matches()) {
            throw new IllegalArgumentException("potion types are lower-case keys: " + key);
          }
        });
    name.ifPresent(
        text -> {
          if (text.isBlank()) {
            throw new IllegalArgumentException("an item name must not be blank");
          }
        });
  }

  /** Any item of {@code material}. */
  public static ItemMatch of(String material) {
    return new ItemMatch(material, Optional.empty(), Map.of(), Optional.empty());
  }

  /** Whether {@code item} counts. */
  public boolean matches(ItemFacts item) {
    if (!item.material().equals(material)) {
      return false;
    }
    if (name.isPresent() && !name.equals(item.name())) {
      return false;
    }
    if (potion.isPresent() && !potion.equals(item.potion())) {
      return false;
    }
    return enchantments.entrySet().stream()
        .allMatch(entry -> item.enchantments().getOrDefault(entry.getKey(), 0) >= entry.getValue());
  }

  /** Whether this asks for more than the bare material. */
  public boolean hasComponents() {
    return name.isPresent() || potion.isPresent() || !enchantments.isEmpty();
  }
}
