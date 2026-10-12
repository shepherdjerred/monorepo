package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.util.List;
import java.util.Map;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;

/** Dependable station maintenance complements the random runic cache rewards. */
final class SurvivalEquipment {
  private final SurvivalRunner runner;

  SurvivalEquipment(SurvivalRunner runner) {
    this.runner = runner;
  }

  void repair(Player player, boolean armor) {
    var inventory = player.getInventory();
    var candidates =
        armor
            ? List.of(
                EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET)
            : List.of(EquipmentSlot.HAND, EquipmentSlot.OFF_HAND);
    var damaged =
        candidates.stream()
            .filter(
                slot -> {
                  var item = inventory.getItem(slot);
                  return item != null
                      && runner.items().owns(item)
                      && (armor
                          || runner.items().weapon(item)
                          || item.getType() == org.bukkit.Material.SHIELD)
                      && item.getItemMeta() instanceof Damageable meta
                      && meta.getDamage() > 0;
                })
            .toList();
    if (damaged.isEmpty()) {
      Texts.info(player, "Nothing needs repairing.");
      return;
    }
    var cost = armor ? 4 : 2;
    if (!runner.items().spend(player, Map.of("IRON_INGOT", cost, "EMERALD", cost))) return;
    damaged.forEach(
        slot -> {
          var item = java.util.Objects.requireNonNull(inventory.getItem(slot));
          item.editMeta(meta -> ((Damageable) meta).setDamage(0));
          inventory.setItem(slot, item);
        });
    runner.feedback().play(player, SurvivalFeedback.Cue.CRAFT);
    runner.hud().hint(player, "Equipment repaired", 2);
  }

  void enchant(Player player) {
    var weapon = player.getInventory().getItemInMainHand();
    if (!runner.items().equipment(weapon)) {
      Texts.error(player, "Hold run equipment first.");
      return;
    }
    var rarity = runner.items().rarity(weapon);
    if (rarity.enchantNext().isEmpty()) {
      Texts.info(player, "This rarity cannot be improved by enchanting.");
      return;
    }
    if (!runner.items().spend(player, rarity.enchantPrice())) return;
    runner.items().rarity(weapon, rarity.enchantNext().orElseThrow());
    player.getInventory().setItemInMainHand(weapon);
    runner.feedback().play(player, SurvivalFeedback.Cue.UPGRADE);
    runner.hud().hint(player, "Equipment enchanted · " + runner.items().rarity(weapon), 2);
  }

  void augment(Player player, org.bukkit.inventory.EquipmentSlot slot, java.util.UUID identity) {
    var gear = player.getInventory().getItem(slot);
    if (!runner.machines().powered()
        || !runner.items().equipment(gear)
        || !runner.items().identity(gear).equals(identity)) return;
    var tier = runner.items().tier(gear);
    if (tier == 3 || !runner.items().spend(player, Map.of("EMERALD", 12 * (tier + 1)))) return;
    runner.items().upgrade(gear, tier + 1);
    player.getInventory().setItem(slot, gear);
    runner.feedback().play(player, SurvivalFeedback.Cue.UPGRADE);
    Texts.info(
        player,
        "Runeforge augmentation " + (tier + 1) + ": repaired; rarity and signature preserved.");
    runner.menus().augment(player);
  }

  static Enchantment primary(ItemStack weapon) {
    var enchantment =
        switch (weapon.getType()) {
          case BOW -> Enchantment.POWER;
          case CROSSBOW -> Enchantment.QUICK_CHARGE;
          case TRIDENT -> Enchantment.LOYALTY;
          default -> Enchantment.SHARPNESS;
        };
    return enchantment.canEnchantItem(weapon) ? enchantment : Enchantment.UNBREAKING;
  }
}
