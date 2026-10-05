package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.util.Optional;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Entity;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/**
 * The persistent-data tags that mark what belongs to a match: every kit item, the Bomb Fuse and the
 * lobby's kit selector and leave item in particular, the primed TNT and holograms that stand for
 * bombs, and the lobby's display entities. Tagged items never leave the match; tagged entities are
 * removed when a match resets, when the lobby is dressed again, or when they turn up after a crash.
 */
final class Keys {

  /** The attack-speed modifier every combatant carries while inside. */
  static final NamespacedKey ATTACK_SPEED = new NamespacedKey("thestorm", "rwf_attack_speed");

  private final NamespacedKey item;
  private final NamespacedKey fuse;
  private final NamespacedKey bomb;
  private final NamespacedKey lobby;
  private final NamespacedKey selector;
  private final NamespacedKey leave;

  Keys(Plugin plugin) {
    this.item = new NamespacedKey(plugin, "rwf_item");
    this.fuse = new NamespacedKey(plugin, "rwf_fuse");
    this.bomb = new NamespacedKey(plugin, "rwf_bomb");
    this.lobby = new NamespacedKey(plugin, "rwf_lobby");
    this.selector = new NamespacedKey(plugin, "rwf_selector");
    this.leave = new NamespacedKey(plugin, "rwf_leave");
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

  /** Marks {@code stack} as the lobby's kit selector (a kit item too, so it never leaves). */
  void tagSelector(ItemStack stack) {
    tag(stack);
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(selector, PersistentDataType.BOOLEAN, true));
  }

  /** Marks {@code stack} as the lobby's leave item (a kit item too, so it never leaves). */
  void tagLeave(ItemStack stack) {
    tag(stack);
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(leave, PersistentDataType.BOOLEAN, true));
  }

  boolean isSelector(ItemStack stack) {
    return has(stack, selector);
  }

  boolean isLeave(ItemStack stack) {
    return has(stack, leave);
  }

  private static boolean has(ItemStack stack, NamespacedKey key) {
    return !stack.isEmpty()
        && stack.hasItemMeta()
        && stack.getItemMeta().getPersistentDataContainer().has(key, PersistentDataType.BOOLEAN);
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

  /** Marks {@code target} as one of the lobby's displays, named {@code part}. */
  void tagLobby(Entity target, String part) {
    target.getPersistentDataContainer().set(lobby, PersistentDataType.STRING, part);
  }

  /** The lobby display part {@code target} is, if it is one. */
  Optional<String> lobbyPart(Entity target) {
    return Optional.ofNullable(
        target.getPersistentDataContainer().get(lobby, PersistentDataType.STRING));
  }
}
