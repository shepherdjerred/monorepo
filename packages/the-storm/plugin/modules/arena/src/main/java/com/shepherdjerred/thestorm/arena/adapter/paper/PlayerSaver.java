package com.shepherdjerred.thestorm.arena.adapter.paper;

import org.bukkit.entity.Player;

/**
 * Writes a player's data to disk now. A restore saves the player before deleting their stored
 * snapshot, so a crash in between can never leave them with neither.
 */
@FunctionalInterface
public interface PlayerSaver {

  void save(Player player);

  /** Paper's own player save. */
  static PlayerSaver paper() {
    return Player::saveData;
  }
}
