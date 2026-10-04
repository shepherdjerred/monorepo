package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.util.List;
import java.util.Map;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;

/** Dependable station maintenance complements the random mystery box rewards. */
final class SurvivalEquipment {
  private final SurvivalRunner runner;

  SurvivalEquipment(SurvivalRunner runner) {
    this.runner = runner;
  }

  void repair(Player player, boolean armor) {
    var armorContents = java.util.Objects.requireNonNull(player.getInventory().getArmorContents());
    var candidates =
        armor
            ? java.util.Arrays.stream(armorContents).filter(java.util.Objects::nonNull).toList()
            : List.of(player.getInventory().getItemInMainHand());
    var damaged =
        candidates.stream()
            .filter(runner.items()::owns)
            .filter(item -> armor || runner.items().weapon(item))
            .filter(item -> item.getItemMeta() instanceof Damageable meta && meta.getDamage() > 0)
            .toList();
    if (damaged.isEmpty()) {
      Texts.info(player, "Nothing needs repairing.");
      return;
    }
    var cost = armor ? 4 : 2;
    if (!runner.items().spend(player, Map.of("IRON_INGOT", cost, "EMERALD", cost))) return;
    damaged.forEach(item -> item.editMeta(meta -> ((Damageable) meta).setDamage(0)));
    if (armor) player.getInventory().setArmorContents(armorContents);
    else player.getInventory().setItemInMainHand(damaged.getFirst());
    runner.feedback().play(player, SurvivalFeedback.Cue.CRAFT);
    runner.hud().hint(player, "Equipment repaired", 2);
  }

  void enchant(Player player) {
    var weapon = player.getInventory().getItemInMainHand();
    if (!runner.items().weapon(weapon)) {
      Texts.error(player, "Hold a run weapon first.");
      return;
    }
    var enchantment = primary(weapon);
    if (!enchantment.canEnchantItem(weapon)
        || weapon.getItemMeta().hasConflictingEnchant(enchantment)) {
      Texts.info(player, "Use Pack-a-Punch to enhance this weapon.");
      return;
    }
    var level = Math.min(2, enchantment.getMaxLevel());
    if (weapon.getEnchantmentLevel(enchantment) >= level) {
      Texts.info(player, "This weapon already has that enchantment.");
      return;
    }
    if (!runner.items().spend(player, Map.of("GLOWSTONE_DUST", 4, "EMERALD", 4))) return;
    weapon.addEnchantment(enchantment, level);
    player.getInventory().setItemInMainHand(weapon);
    runner.feedback().play(player, SurvivalFeedback.Cue.UPGRADE);
    runner.hud().hint(player, "Weapon enchanted", 2);
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
