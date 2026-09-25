package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.util.Optional;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Entity;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/**
 * The persistent-data tags that mark what belongs to an arena: every item it hands out, and every
 * mob, boss, pet and wolf it spawns. Tagged items never leave an arena; tagged entities are removed
 * when a game ends or turn up after a crash.
 */
final class Keys {

  private final NamespacedKey item;
  private final NamespacedKey entity;

  Keys(Plugin plugin) {
    this.item = new NamespacedKey(plugin, "arena_item");
    this.entity = new NamespacedKey(plugin, "arena_entity");
  }

  /** Marks {@code stack} as an arena item. */
  void tag(ItemStack stack) {
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(item, PersistentDataType.BOOLEAN, true));
  }

  boolean isArenaItem(ItemStack stack) {
    return !stack.isEmpty()
        && stack.hasItemMeta()
        && stack.getItemMeta().getPersistentDataContainer().has(item, PersistentDataType.BOOLEAN);
  }

  /** Marks {@code target} as belonging to arena {@code arena}. */
  void tag(Entity target, String arena) {
    target.getPersistentDataContainer().set(entity, PersistentDataType.STRING, arena);
  }

  /** The arena {@code target} belongs to, if it is an arena entity. */
  Optional<String> arenaOf(Entity target) {
    return Optional.ofNullable(
        target.getPersistentDataContainer().get(entity, PersistentDataType.STRING));
  }
}
