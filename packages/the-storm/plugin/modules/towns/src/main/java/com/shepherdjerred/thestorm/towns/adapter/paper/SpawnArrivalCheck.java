package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.core.world.SpawnArrivals;
import org.bukkit.Location;

/** A world's arrival is the square around {@code World#getSpawnLocation()}. */
public final class SpawnArrivalCheck implements SpawnArrivals {
  private final int radius;

  public SpawnArrivalCheck(int radius) {
    this.radius = radius;
  }

  @Override
  public int radius() {
    return radius;
  }

  @Override
  public boolean contains(Location location) {
    var world = location.getWorld();
    if (world == null) {
      return false;
    }
    var spawn = world.getSpawnLocation();
    var east = Math.abs(location.getX() - spawn.getX());
    var south = Math.abs(location.getZ() - spawn.getZ());
    return east <= radius && south <= radius;
  }
}
