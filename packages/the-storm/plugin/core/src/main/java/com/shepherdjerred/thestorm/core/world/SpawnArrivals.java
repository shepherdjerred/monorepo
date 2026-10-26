package com.shepherdjerred.thestorm.core.world;

import org.bukkit.Location;

/** Whether a player is standing in a world's arrival, using that world's spawn radius. */
public interface SpawnArrivals {

  /** The horizontal radius, in blocks, around a world spawn. */
  int radius();

  /** Whether {@code location} is inside its world's arrival square. */
  boolean contains(Location location);
}
