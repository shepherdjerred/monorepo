package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.view.WeaponProfile;
import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import java.util.Optional;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlotGroup;
import org.bukkit.inventory.ItemStack;

/** The player attributes a match reads and sets. */
final class PlayerAttributes {

  private PlayerAttributes() {}

  /** The combat tracker owns rate limiting while RWF runs; snapshots restore the native limit. */
  static void useMatchHitWindow(Player player) {
    player.setMaximumNoDamageTicks(0);
    player.setNoDamageTicks(0);
  }

  /** Gives {@code player} the match's attack-speed modifier, so the 1.9 cooldown never applies. */
  static void addAttackSpeed(Player player) {
    var held = KitFactory.spec(player.getInventory().getItemInMainHand(), Optional.empty());
    if (WeaponProfile.of(held).nativeMelee()) {
      removeAttackSpeed(player);
      return;
    }
    var attribute = player.getAttribute(Attribute.ATTACK_SPEED);
    if (attribute == null) {
      // A real player always carries attack speed; a bot entity may need it registered.
      player.registerAttribute(Attribute.ATTACK_SPEED);
      attribute = player.getAttribute(Attribute.ATTACK_SPEED);
    }
    if (attribute == null) {
      throw new IllegalStateException(
          "attack speed could not be registered on " + player.getName());
    }
    addLegacyAttackSpeed(player);
  }

  /** Synchronizes a slot change before Bukkit changes the inventory's selected slot. */
  static void heldAttackSpeed(Player player, int slot) {
    handAttackSpeed(player, Optional.ofNullable(player.getInventory().getItem(slot)));
  }

  static void handAttackSpeed(Player player, Optional<ItemStack> item) {
    if (item.map(stack -> WeaponProfile.of(KitFactory.spec(stack, Optional.empty())).nativeMelee())
        .orElse(false)) {
      removeAttackSpeed(player);
    } else {
      addLegacyAttackSpeed(player);
    }
  }

  private static void addLegacyAttackSpeed(Player player) {
    var attribute = player.getAttribute(Attribute.ATTACK_SPEED);
    if (attribute == null) {
      throw new IllegalStateException("players always have attack speed");
    }
    attribute.removeModifier(Keys.ATTACK_SPEED);
    attribute.addModifier(
        new AttributeModifier(
            Keys.ATTACK_SPEED,
            CombatRules.ATTACK_SPEED_MODIFIER,
            AttributeModifier.Operation.ADD_NUMBER,
            EquipmentSlotGroup.ANY));
  }

  static void removeAttackSpeed(Player player) {
    var attribute = player.getAttribute(Attribute.ATTACK_SPEED);
    if (attribute != null) {
      attribute.removeModifier(Keys.ATTACK_SPEED);
    }
  }

  /** {@code player}'s maximum health, kit modifiers included. */
  static double maxHealth(Player player) {
    var attribute = player.getAttribute(Attribute.MAX_HEALTH);
    if (attribute == null) {
      throw new IllegalStateException("players always have max health");
    }
    return attribute.getValue();
  }
}
