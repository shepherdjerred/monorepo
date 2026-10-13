package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.combat.CombatRules;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlotGroup;

/** The player attributes a match reads and sets. */
final class PlayerAttributes {

  private PlayerAttributes() {}

  /** Gives {@code player} the match's attack-speed modifier, so the 1.9 cooldown never applies. */
  static void addAttackSpeed(Player player) {
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
