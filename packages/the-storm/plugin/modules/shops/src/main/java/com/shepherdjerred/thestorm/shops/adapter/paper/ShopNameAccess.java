package com.shepherdjerred.thestorm.shops.adapter.paper;

import java.util.Locale;
import org.bukkit.entity.Player;

/**
 * Whether a player may create, destroy, or open a shop whose sign names someone else. A set name
 * node wins; otherwise the action's parent node decides. Names are not a list in this class.
 */
final class ShopNameAccess {

  private ShopNameAccess() {}

  static boolean may(Player player, String action, String name) {
    var specific = "thestorm.shops.other." + action + "." + name.toLowerCase(Locale.ROOT);
    if (player.isPermissionSet(specific)) {
      return player.hasPermission(specific);
    }
    return player.hasPermission("thestorm.shops.other." + action);
  }
}
