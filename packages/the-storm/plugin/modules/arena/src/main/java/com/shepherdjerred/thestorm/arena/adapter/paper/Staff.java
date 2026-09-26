package com.shepherdjerred.thestorm.arena.adapter.paper;

import org.bukkit.GameMode;
import org.bukkit.entity.Player;

/** Staff at work: never ejected from, or refused entry to, a running arena. */
final class Staff {

  private Staff() {}

  /**
   * Whether {@code player} may be in a running arena without playing: anyone in creative or
   * spectator mode (which only staff can set), or holding {@code thestorm.arena.admin}.
   */
  static boolean exempt(Player player) {
    var mode = player.getGameMode();
    return mode == GameMode.CREATIVE
        || mode == GameMode.SPECTATOR
        || player.hasPermission(ArenaPermissions.ADMIN);
  }
}
