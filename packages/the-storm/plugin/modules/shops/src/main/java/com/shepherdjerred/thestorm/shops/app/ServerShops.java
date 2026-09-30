package com.shepherdjerred.thestorm.shops.app;

import java.util.Set;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/**
 * The NPC shops. The npcs module calls {@link #open(Player, String, Location)} when a player talks
 * to a shopkeeper; its content should name catalogs that {@link #has} accepts. The player must stay
 * within {@code catalogs.maxDistance} blocks of the shopkeeper for every button in the shop. Main
 * thread only.
 */
public interface ServerShops {

  /**
   * Shows {@code player} the catalog's menu, tied to where the shopkeeper stands.
   *
   * @throws IllegalArgumentException if no catalog has {@code catalogId}
   */
  void open(Player player, String catalogId, Location shopkeeper);

  /**
   * Shows {@code player} the catalog's menu, tied to where the player stands (admin testing).
   *
   * @throws IllegalArgumentException if no catalog has {@code catalogId}
   */
  void open(Player player, String catalogId);

  /** Whether a catalog with this id is loaded. */
  boolean has(String catalogId);

  /** Every loaded catalog id. */
  Set<String> catalogIds();
}
