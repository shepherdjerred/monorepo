package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.util.Optional;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Entity;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/**
 * The persistent-data tags that mark what belongs to a match: every kit item, the Bomb Fuse in
 * particular, and the primed TNT and holograms that stand for bombs. Tagged items never leave the
 * match; tagged entities are removed when a match resets or turn up after a crash.
 */
final class Keys {

  /** The attack-speed modifier every combatant carries while inside. */
  static final NamespacedKey ATTACK_SPEED = new NamespacedKey("thestorm", "rwf_attack_speed");

  private final NamespacedKey item;
  private final NamespacedKey fuse;
  private final NamespacedKey bomb;

  Keys(Plugin plugin) {
    this.item = new NamespacedKey(plugin, "rwf_item");
    this.fuse = new NamespacedKey(plugin, "rwf_fuse");
    this.bomb = new NamespacedKey(plugin, "rwf_bomb");
  }

  /** Marks {@code stack} as a kit item. */
  void tag(ItemStack stack) {
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(item, PersistentDataType.BOOLEAN, true));
  }

  /** Marks {@code stack} as the Bomb Fuse (a kit item too). */
  void tagFuse(ItemStack stack) {
    tag(stack);
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(fuse, PersistentDataType.BOOLEAN, true));
  }

  boolean isKitItem(ItemStack stack) {
    return !stack.isEmpty()
        && stack.hasItemMeta()
        && stack.getItemMeta().getPersistentDataContainer().has(item, PersistentDataType.BOOLEAN);
  }

  boolean isFuse(ItemStack stack) {
    return !stack.isEmpty()
        && stack.hasItemMeta()
        && stack.getItemMeta().getPersistentDataContainer().has(fuse, PersistentDataType.BOOLEAN);
  }

  /** Marks {@code target} as standing for the bomb {@code bombId}. */
  void tagBomb(Entity target, String bombId) {
    target.getPersistentDataContainer().set(bomb, PersistentDataType.STRING, bombId);
  }

  /** The bomb {@code target} stands for, if it is a bomb entity. */
  Optional<String> bombOf(Entity target) {
    return Optional.ofNullable(
        target.getPersistentDataContainer().get(bomb, PersistentDataType.STRING));
  }
}
