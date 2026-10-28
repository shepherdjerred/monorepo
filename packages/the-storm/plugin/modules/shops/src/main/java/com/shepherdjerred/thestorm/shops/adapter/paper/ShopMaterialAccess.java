package com.shepherdjerred.thestorm.shops.adapter.paper;

import java.util.Locale;
import org.bukkit.entity.Player;

/**
 * Whether a player may create, buy, or sell one material. A set material node wins; otherwise the
 * action's parent node decides. Food and gear bundles are permission children of that parent, not a
 * list of items in this class.
 */
final class ShopMaterialAccess {

  private ShopMaterialAccess() {}

  static boolean may(Player player, String action, String material) {
    if (!material.isEmpty()) {
      var specific = "thestorm.shops." + action + "." + material.toLowerCase(Locale.ROOT);
      if (player.isPermissionSet(specific)) {
        return player.hasPermission(specific);
      }
    }
    return player.hasPermission("thestorm.shops." + action);
  }
}
