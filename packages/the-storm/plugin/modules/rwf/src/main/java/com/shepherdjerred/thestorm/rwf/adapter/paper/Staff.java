package com.shepherdjerred.thestorm.rwf.adapter.paper;

import org.bukkit.GameMode;
import org.bukkit.entity.Player;

/** Staff at work: may enter the rwf world without playing, and change its blocks. */
final class Staff {

  private Staff() {}

  /**
   * Whether {@code player} is exempt from the world's rules: anyone in creative or spectator mode
   * (which only staff can set), or holding {@code thestorm.rwf.admin}.
   */
  static boolean exempt(Player player) {
    var mode = player.getGameMode();
    return mode == GameMode.CREATIVE
        || mode == GameMode.SPECTATOR
        || player.hasPermission(RwfPermissions.ADMIN);
  }
}
