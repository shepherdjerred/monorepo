package com.shepherdjerred.thestorm.quests.domain.content;

import java.util.Set;

/**
 * What exists on the server, for checking content references. The Paper adapter fills this from the
 * live registries and the NPC directory; tests fill it from the shipped content.
 *
 * @param npcs NPC ids
 * @param items material names that are items
 * @param blocks material names that are blocks
 * @param entities entity type names that can be spawned or killed
 * @param worlds world keys
 * @param tracks track ids
 * @param enchantments enchantment keys (without the {@code minecraft:} namespace)
 * @param potions potion type keys (without the namespace)
 */
public record ContentRegistry(
    Set<String> npcs,
    Set<String> items,
    Set<String> blocks,
    Set<String> entities,
    Set<String> worlds,
    Set<String> tracks,
    Set<String> enchantments,
    Set<String> potions) {

  public ContentRegistry {
    npcs = Set.copyOf(npcs);
    items = Set.copyOf(items);
    blocks = Set.copyOf(blocks);
    entities = Set.copyOf(entities);
    worlds = Set.copyOf(worlds);
    tracks = Set.copyOf(tracks);
    enchantments = Set.copyOf(enchantments);
    potions = Set.copyOf(potions);
  }
}
