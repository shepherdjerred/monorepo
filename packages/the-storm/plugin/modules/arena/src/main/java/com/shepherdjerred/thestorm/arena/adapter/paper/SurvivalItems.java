package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalClass;
import com.shepherdjerred.thestorm.arena.domain.survival.SurvivalContent;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/** Physical, run-bound resources. Spending and crafting are atomic on the server thread. */
final class SurvivalItems {
  private final Keys keys;
  private final UUID run;
  private final SurvivalFeedback feedback;
  private final SurvivalContent content;

  SurvivalItems(Keys keys, UUID run, SurvivalFeedback feedback, SurvivalContent content) {
    this.keys = keys;
    this.run = run;
    this.feedback = feedback;
    this.content = content;
  }

  static Material material(String id) {
    var result = Material.matchMaterial(id);
    if (result == null || !result.isItem()) {
      throw new IllegalArgumentException("Unknown item: " + id);
    }
    return result;
  }

  static void validate(SurvivalContent content) {
    content
        .recipes()
        .forEach(
            recipe -> {
              material(recipe.material());
              recipe.ingredients().keySet().forEach(SurvivalItems::material);
            });
    content.zones().stream()
        .flatMap(z -> z.resources().stream())
        .forEach(resource -> material(resource.material()));
    content.legendaries().forEach(reward -> material(reward.material()));
  }

  ItemStack legendary(com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon id) {
    var reward = content.legendaries().stream().filter(r -> r.id() == id).findFirst().orElseThrow();
    var weapon = stack(material(reward.material()), 1);
    keys.legendary(weapon, id);
    weapon.editMeta(
        meta -> {
          meta.displayName(
              net.kyori.adventure.text.Component.text(
                  "Legendary · " + reward.name(),
                  net.kyori.adventure.text.format.NamedTextColor.GOLD));
          meta.lore(
              java.util.List.of(net.kyori.adventure.text.Component.text(reward.description())));
        });
    return weapon;
  }

  java.util.Optional<com.shepherdjerred.thestorm.arena.domain.survival.LegendaryWeapon> legendary(
      ItemStack item) {
    return owns(item) ? keys.legendary(item) : java.util.Optional.empty();
  }

  boolean ability(ItemStack item) {
    return owns(item) && keys.isGear(item, "survival_ability");
  }

  void ability(Player player) {
    var compass = stack(Material.COMPASS, 1);
    keys.gear(compass, "survival_ability");
    compass.editMeta(
        meta -> {
          meta.setEnchantmentGlintOverride(true);
          meta.displayName(net.kyori.adventure.text.Component.text("Class ability · Right-click"));
          meta.lore(
              java.util.List.of(
                  net.kyori.adventure.text.Component.text("Sneak + right-click: class upgrades")));
        });
    player.getInventory().setItem(8, compass);
  }

  /** Simulate the entire bundle before committing a single storage replacement. */
  boolean deliver(Player player, java.util.List<ItemStack> bundle) {
    var storage = java.util.Objects.requireNonNull(player.getInventory().getStorageContents());
    for (var slot = 0; slot < storage.length; slot++) {
      var existing = storage[slot];
      if (existing != null) storage[slot] = existing.clone();
    }
    for (var item : bundle) {
      if (!insert(storage, item)) return false;
    }
    player.getInventory().setStorageContents(storage);
    return true;
  }

  private static boolean insert(
      @org.jspecify.annotations.Nullable ItemStack[] storage, ItemStack item) {
    var left = item.getAmount();
    for (var slot = 0; slot < storage.length && left > 0; slot++) {
      var existing = storage[slot];
      if (existing != null && !existing.isEmpty() && !existing.isSimilar(item)) continue;
      var count = existing == null || existing.isEmpty() ? 0 : existing.getAmount();
      var added = Math.min(left, item.getMaxStackSize() - count);
      if (added <= 0) continue;
      var merged = item.clone();
      merged.setAmount(count + added);
      storage[slot] = merged;
      left -= added;
    }
    return left == 0;
  }

  ItemStack stack(Material material, int amount) {
    var result = ItemStack.of(material, amount);
    keys.tag(result, run);
    return result;
  }

  boolean owns(ItemStack item) {
    return keys.belongsTo(item, run);
  }

  int count(Player player, Material material) {
    var count = 0;
    for (var item : java.util.Objects.requireNonNull(player.getInventory().getContents())) {
      if (item != null && owns(item) && item.getType() == material) {
        count += item.getAmount();
      }
    }
    return count;
  }

  boolean fits(Player player, Material material, int amount) {
    var sample = stack(material, 1);
    var room = 0;
    for (var item : java.util.Objects.requireNonNull(player.getInventory().getStorageContents())) {
      room +=
          item == null || item.isEmpty()
              ? sample.getMaxStackSize()
              : item.isSimilar(sample) ? item.getMaxStackSize() - item.getAmount() : 0;
    }
    return room >= amount;
  }

  boolean give(Player player, Material material, int amount) {
    if (!fits(player, material, amount)) {
      Texts.error(player, "Make room in your inventory first.");
      feedback.play(player, SurvivalFeedback.Cue.FAILURE);
      return false;
    }
    var remaining = amount;
    while (remaining > 0) {
      var batch = Math.min(remaining, material.getMaxStackSize());
      player.getInventory().addItem(stack(material, batch));
      remaining -= batch;
    }
    return true;
  }

  boolean spend(Player player, Map<String, Integer> price) {
    if (price.entrySet().stream()
        .anyMatch(e -> count(player, material(e.getKey())) < e.getValue())) {
      Texts.error(player, "You need " + price + ".");
      feedback.play(player, SurvivalFeedback.Cue.FAILURE);
      return false;
    }
    price.forEach((id, amount) -> remove(player, material(id), amount));
    return true;
  }

  private void remove(Player player, Material material, int amount) {
    var inventory = player.getInventory();
    var left = amount;
    for (var slot = 0; slot < inventory.getSize() && left > 0; slot++) {
      var item = inventory.getItem(slot);
      if (item != null && owns(item) && item.getType() == material) {
        var taken = Math.min(left, item.getAmount());
        item.setAmount(item.getAmount() - taken);
        left -= taken;
        inventory.setItem(slot, item.isEmpty() ? null : item);
      }
    }
  }

  void equip(Player player, SurvivalClass role, boolean returning) {
    PlayerStates.wipe(player, org.bukkit.GameMode.SURVIVAL);
    give(player, Material.STONE_SWORD, 1);
    give(player, Material.BREAD, returning ? 2 : 5);
    player.getInventory().setChestplate(stack(Material.LEATHER_CHESTPLATE, 1));
    if (!returning) {
      player.getInventory().setHelmet(stack(Material.LEATHER_HELMET, 1));
      player.getInventory().setLeggings(stack(Material.LEATHER_LEGGINGS, 1));
      player.getInventory().setBoots(stack(Material.LEATHER_BOOTS, 1));
    }
    switch (role) {
      case FIGHTER -> player.getInventory().setItemInOffHand(stack(Material.SHIELD, 1));
      case RANGER -> {
        give(player, Material.BOW, 1);
        give(player, Material.ARROW, returning ? 12 : 24);
      }
      case MEDIC -> give(player, Material.GOLDEN_APPLE, returning ? 1 : 2);
      case ENGINEER -> {
        give(player, Material.OAK_PLANKS, 12);
        give(player, Material.IRON_INGOT, 4);
      }
      case ALCHEMIST -> {
        give(player, Material.REDSTONE, 8);
        give(player, Material.GLOWSTONE_DUST, 8);
      }
      case BEASTMASTER -> give(player, Material.BONE, 8);
    }
    ability(player);
  }

  boolean weapon(ItemStack stack) {
    return owns(stack)
        && (stack.getType().name().endsWith("_SWORD")
            || stack.getType().name().endsWith("_AXE")
            || stack.getType() == Material.BOW
            || stack.getType() == Material.CROSSBOW
            || stack.getType() == Material.TRIDENT
            || legendary(stack).isPresent());
  }

  int tier(ItemStack stack) {
    return keys.upgrade(stack);
  }

  double multiplier(ItemStack stack) {
    if (!weapon(stack)) return 1;
    return switch (tier(stack)) {
      case 0 -> 1;
      case 1 -> 1.35;
      case 2 -> 1.70;
      case 3 -> 2.10;
      default -> throw new IllegalStateException("Invalid weapon tier");
    };
  }

  void upgrade(ItemStack stack, int tier) {
    if (!weapon(stack) || tier < 1 || tier > 3)
      throw new IllegalArgumentException("Invalid upgrade");
    keys.upgrade(stack, tier);
    stack.editMeta(
        meta -> {
          meta.displayName(
              net.kyori.adventure.text.Component.text(
                  "Pack-a-Punch "
                      + tier
                      + " · "
                      + legendary(stack)
                          .map(
                              id ->
                                  content.legendaries().stream()
                                      .filter(r -> r.id() == id)
                                      .findFirst()
                                      .orElseThrow()
                                      .name())
                          .orElseGet(() -> stack.getType().name())));
          if (meta instanceof org.bukkit.inventory.meta.Damageable damageable)
            damageable.setDamage(0);
        });
  }

  void debug(Player player, int round) {
    var preset = com.shepherdjerred.thestorm.arena.domain.survival.DebugPreset.at(round);
    if (preset.iron()) {
      var inventory = player.getInventory();
      inventory.setItem(0, stack(Material.IRON_SWORD, 1));
      inventory.setHelmet(stack(Material.IRON_HELMET, 1));
      inventory.setChestplate(stack(Material.IRON_CHESTPLATE, 1));
      inventory.setLeggings(stack(Material.IRON_LEGGINGS, 1));
      inventory.setBoots(stack(Material.IRON_BOOTS, 1));
      give(player, Material.IRON_INGOT, 16);
      give(player, Material.REDSTONE, 16);
      give(player, Material.BREAD, 12);
      give(player, Material.EMERALD, preset.emeralds());
    }
    if (preset.weaponTier() > 0) {
      for (var item :
          java.util.Objects.requireNonNull(player.getInventory().getStorageContents())) {
        if (item != null && weapon(item)) upgrade(item, preset.weaponTier());
      }
    }
  }

  static void heal(Player player, double amount) {
    var max = player.getAttribute(org.bukkit.attribute.Attribute.MAX_HEALTH);
    if (max == null) {
      throw new IllegalStateException("Player has no max health");
    }
    player.setHealth(Math.min(max.getValue(), player.getHealth() + amount));
    player.addPotionEffect(new PotionEffect(PotionEffectType.REGENERATION, 60, 0));
  }
}
