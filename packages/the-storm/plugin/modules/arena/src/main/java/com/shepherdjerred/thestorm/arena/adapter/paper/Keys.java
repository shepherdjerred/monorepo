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
  private final NamespacedKey run;
  private final NamespacedKey gear;
  private final NamespacedKey upgrade;
  private final NamespacedKey legendary;
  private final NamespacedKey rarity;
  private final NamespacedKey identity;

  Keys(Plugin plugin) {
    this.item = new NamespacedKey(plugin, "arena_item");
    this.entity = new NamespacedKey(plugin, "arena_entity");
    this.run = new NamespacedKey(plugin, "survival_run");
    this.gear = new NamespacedKey(plugin, "arena_gear");
    this.upgrade = new NamespacedKey(plugin, "survival_upgrade");
    this.legendary = new NamespacedKey(plugin, "survival_legendary");
    this.rarity = new NamespacedKey(plugin, "survival_rarity");
    this.identity = new NamespacedKey(plugin, "survival_equipment_id");
  }

  void rarity(ItemStack stack, com.shepherdjerred.thestorm.arena.domain.survival.GearRarity value) {
    stack.editMeta(
        meta ->
            meta.getPersistentDataContainer().set(rarity, PersistentDataType.STRING, value.name()));
  }

  com.shepherdjerred.thestorm.arena.domain.survival.GearRarity rarity(ItemStack stack) {
    return com.shepherdjerred.thestorm.arena.domain.survival.GearRarity.valueOf(
        java.util.Objects.requireNonNull(
            stack.getItemMeta().getPersistentDataContainer().get(rarity, PersistentDataType.STRING),
            "Run equipment has no rarity"));
  }

  void identity(ItemStack stack, java.util.UUID value) {
    stack.editMeta(
        meta ->
            meta.getPersistentDataContainer()
                .set(identity, PersistentDataType.STRING, value.toString()));
  }

  java.util.UUID identity(ItemStack stack) {
    return java.util.UUID.fromString(
        java.util.Objects.requireNonNull(
            stack
                .getItemMeta()
                .getPersistentDataContainer()
                .get(identity, PersistentDataType.STRING),
            "Run equipment has no identity"));
  }

  void legendary(
      ItemStack stack, com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon id) {
    stack.editMeta(
        meta ->
            meta.getPersistentDataContainer().set(legendary, PersistentDataType.STRING, id.name()));
  }

  Optional<com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon> legendary(
      ItemStack stack) {
    if (stack.isEmpty() || !stack.hasItemMeta()) return Optional.empty();
    return Optional.ofNullable(
            stack
                .getItemMeta()
                .getPersistentDataContainer()
                .get(legendary, PersistentDataType.STRING))
        .map(com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon::valueOf);
  }

  int upgrade(ItemStack stack) {
    if (stack.isEmpty() || !stack.hasItemMeta()) return 0;
    var value =
        stack.getItemMeta().getPersistentDataContainer().get(upgrade, PersistentDataType.INTEGER);
    return value == null ? 0 : value;
  }

  void upgrade(ItemStack stack, int tier) {
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(upgrade, PersistentDataType.INTEGER, tier));
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

  void gear(ItemStack stack, String id) {
    stack.editMeta(
        meta -> meta.getPersistentDataContainer().set(gear, PersistentDataType.STRING, id));
  }

  boolean isGear(ItemStack stack, String id) {
    return !stack.isEmpty()
        && stack.hasItemMeta()
        && id.equals(
            stack.getItemMeta().getPersistentDataContainer().get(gear, PersistentDataType.STRING));
  }

  void tag(ItemStack stack, java.util.UUID runId) {
    tag(stack);
    stack.editMeta(
        meta ->
            meta.getPersistentDataContainer()
                .set(run, PersistentDataType.STRING, runId.toString()));
  }

  boolean belongsTo(ItemStack stack, java.util.UUID runId) {
    return isArenaItem(stack)
        && runId
            .toString()
            .equals(
                stack
                    .getItemMeta()
                    .getPersistentDataContainer()
                    .get(run, PersistentDataType.STRING));
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
