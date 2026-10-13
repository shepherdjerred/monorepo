package com.shepherdjerred.thestorm.rwf.domain.kit;

import java.util.HashMap;
import java.util.List;
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
 * @param name an optional display name (plain text); an empty one is a title of nothing but its
 *     colour, as Red Warfare gave the Medic's wand
 * @param enchantments enchantment key (such as {@code sharpness}) to level
 * @param slot the armor slot it is worn in; empty for hotbar items
 * @param look its name colour, lore, glint and dye
 */
public record ItemSpec(
    String material,
    int amount,
    Optional<String> name,
    Map<String, Integer> enchantments,
    Optional<ArmorSlot> slot,
    ItemLook look) {

  /** The material of a hotbar gap: a slot the kit leaves empty, as Ghost's second slot. */
  public static final String GAP = "AIR";

  private static final Pattern MATERIAL = Pattern.compile("[A-Z][A-Z0-9_]*");
  private static final Pattern KEY = Pattern.compile("[a-z0-9_.-]+");

  public ItemSpec {
    if (!MATERIAL.matcher(material).matches()) {
      throw new IllegalArgumentException("material must look like IRON_SWORD: " + material);
    }
    if (amount < 1 || amount > 64) {
      throw new IllegalArgumentException("amount must be 1-64: " + amount);
    }
    if (name.isPresent() && !name.orElseThrow().isEmpty() && name.orElseThrow().isBlank()) {
      throw new IllegalArgumentException("name must not be only spaces");
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

  /** An empty hotbar slot, kept so the items after it stay where the kit put them. */
  public static ItemSpec gap() {
    return of(GAP);
  }

  /** Whether this is an empty slot rather than an item. */
  public boolean isGap() {
    return GAP.equals(material);
  }

  public static ItemSpec of(String material) {
    return of(material, 1);
  }

  public static ItemSpec of(String material, int amount) {
    return new ItemSpec(
        material, amount, Optional.empty(), Map.of(), Optional.empty(), ItemLook.PLAIN);
  }

  public static ItemSpec armor(String material, ArmorSlot slot) {
    return new ItemSpec(material, 1, Optional.empty(), Map.of(), Optional.of(slot), ItemLook.PLAIN);
  }

  public ItemSpec named(String displayName) {
    return new ItemSpec(material, amount, Optional.of(displayName), enchantments, slot, look);
  }

  /** Named {@code displayName} in {@code color}, as Red Warfare titled its kit items. */
  public ItemSpec named(String displayName, String color) {
    return new ItemSpec(
        material, amount, Optional.of(displayName), enchantments, slot, look.withNameColor(color));
  }

  /** {@code amount} of this item. */
  public ItemSpec times(int amount) {
    return new ItemSpec(material, amount, name, enchantments, slot, look);
  }

  public ItemSpec enchanted(String key, int level) {
    var next = new HashMap<>(enchantments);
    next.put(key, level);
    return new ItemSpec(material, amount, name, next, slot, look);
  }

  public ItemSpec lore(String color, String... lines) {
    return new ItemSpec(
        material, amount, name, enchantments, slot, look.withLore(color, List.of(lines)));
  }

  /** Shimmering as if enchanted, without an enchantment. */
  public ItemSpec glinting() {
    return new ItemSpec(material, amount, name, enchantments, slot, look.withGlint());
  }

  /** This item, looking like {@code look}. */
  public ItemSpec withLook(ItemLook look) {
    return new ItemSpec(material, amount, name, enchantments, slot, look);
  }

  public ItemSpec dyed(String dye) {
    return new ItemSpec(material, amount, name, enchantments, slot, look.withDye(dye));
  }

  public int enchantmentLevel(String key) {
    return enchantments.getOrDefault(key, 0);
  }
}
