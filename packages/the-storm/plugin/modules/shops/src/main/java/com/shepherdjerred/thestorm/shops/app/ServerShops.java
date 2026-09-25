package com.shepherdjerred.thestorm.shops.app;

import java.util.Set;
import org.bukkit.entity.Player;

/**
 * The NPC shops. The npcs module calls {@link #open} when a player talks to a shopkeeper; its
 * content should name catalogs that {@link #has} accepts. Main thread only.
 */
public interface ServerShops {

  /**
   * Shows {@code player} the catalog's menu.
   *
   * @throws IllegalArgumentException if no catalog has {@code catalogId}
   */
  void open(Player player, String catalogId);

  /** Whether a catalog with this id is loaded. */
  boolean has(String catalogId);

  /** Every loaded catalog id. */
  Set<String> catalogIds();
}
