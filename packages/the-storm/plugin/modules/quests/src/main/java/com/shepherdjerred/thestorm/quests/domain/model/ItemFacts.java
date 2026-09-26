package com.shepherdjerred.thestorm.quests.domain.model;

import java.util.Map;
import java.util.Optional;

/**
 * What an item stack is, as far as quests care. The Paper adapter reads these from item stacks.
 *
 * @param material its material name
 * @param name its custom name as plain text, if it has one
 * @param enchantments its enchantment keys and levels
 * @param potion its potion type key, if it is a potion
 */
public record ItemFacts(
    String material,
    Optional<String> name,
    Map<String, Integer> enchantments,
    Optional<String> potion) {

  public ItemFacts {
    enchantments = Map.copyOf(enchantments);
  }

  /** A plain item of {@code material}. */
  public static ItemFacts of(String material) {
    return new ItemFacts(material, Optional.empty(), Map.of(), Optional.empty());
  }
}
