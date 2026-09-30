package com.shepherdjerred.thestorm.qol.adapter.paper;

import java.util.function.Consumer;
import org.bukkit.entity.Player;

/**
 * The server calls graves make that test servers cannot: resolving a player's skin and writing
 * their player data to disk.
 *
 * @param face the face grave heads wear
 * @param saveData writes a player's inventory to disk now, so a crash cannot roll it back to a copy
 *     that still holds items a grave also holds
 */
record ServerHooks(GraveFace face, Consumer<Player> saveData) {

  /** A real server. */
  static final ServerHooks PAPER = new ServerHooks(GraveFace.OWNER, Player::saveData);
}
