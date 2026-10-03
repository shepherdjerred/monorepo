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

  SurvivalItems(Keys keys, UUID run) {
    this.keys = keys;
    this.run = run;
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
    if (returning) {
      return;
    }
    switch (role) {
      case FIGHTER -> player.getInventory().setItemInOffHand(stack(Material.SHIELD, 1));
      case RANGER -> {
        give(player, Material.BOW, 1);
        give(player, Material.ARROW, 24);
      }
      case MEDIC -> give(player, Material.GOLDEN_APPLE, 2);
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
