package com.shepherdjerred.thestorm.companions.adapter.paper;

import java.util.Optional;
import java.util.function.Predicate;
import org.bukkit.Location;
import org.bukkit.block.Block;

/** Incremental bounded scans of loaded chunks; never loads terrain on the tick thread. */
public final class ResourceScan {
  private final int radius;
  private final Location center;
  private int cursor;

  public ResourceScan(Location center, int radius) {
    this.center = center.clone();
    this.radius = radius;
  }

  public boolean finished() {
    var width = radius * 2 + 1;
    return cursor >= width * width * width;
  }

  public Optional<Block> advance(int budget, Predicate<Block> wanted) {
    var width = radius * 2 + 1;
    var volume = width * width * width;
    for (var scanned = 0; scanned < budget && cursor < volume; scanned++) {
      var index = cursor++;
      var x = center.getBlockX() + index % width - radius;
      var z = center.getBlockZ() + index / width % width - radius;
      var vertical = index / (width * width);
      var y = center.getBlockY() + (vertical % 2 == 0 ? -vertical / 2 : (vertical + 1) / 2);
      var world = center.getWorld();
      if (y < world.getMinHeight()
          || y >= world.getMaxHeight()
          || !world.isChunkLoaded(x >> 4, z >> 4)) continue;
      var block = world.getBlockAt(x, y, z);
      if (wanted.test(block)) return Optional.of(block);
    }
    return Optional.empty();
  }
}
