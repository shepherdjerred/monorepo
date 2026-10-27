package com.shepherdjerred.thestorm.creative.app;

import org.bukkit.Location;
import org.bukkit.entity.Player;

/** Enters the sealed creative world through its inventory-preserving visit flow. */
public interface CreativeEntry {
  /** Starts a visit, or reports the reason the player cannot enter. Main thread only. */
  void enter(Player player);

  /** The creative entry location, for pre-entry checks by a travel integration. */
  Location destination();
}
