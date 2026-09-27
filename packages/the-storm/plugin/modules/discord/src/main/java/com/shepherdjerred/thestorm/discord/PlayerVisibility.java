package com.shepherdjerred.thestorm.discord;

import org.bukkit.entity.Player;

/** Uses the vanish signal shared by EssentialsX and other supported plugins. */
public final class PlayerVisibility {

  private PlayerVisibility() {}

  public static boolean isPublic(Player player) {
    return !player.hasMetadata("vanished");
  }
}
