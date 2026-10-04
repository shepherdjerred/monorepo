package com.shepherdjerred.thestorm.companions.adapter.paper;

import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.bukkit.Location;
import org.bukkit.block.Block;

/** Small main-thread geometry queries that never load a chunk. */
final class NearbyBlocks {
  private NearbyBlocks() {}

  static Stream<Block> box(Location center, int horizontal, int vertical) {
    return footprint(
        center.clone().subtract(horizontal, vertical, horizontal),
        horizontal * 2 + 1,
        horizontal * 2 + 1,
        vertical * 2 + 1);
  }

  static Stream<Block> footprint(Location origin, int width, int depth, int height) {
    return IntStream.range(0, width * depth * height)
        .mapToObj(
            index -> {
              var x = index % width;
              var y = index / (width * depth);
              var z = index / width % depth;
              return origin.clone().add(x, y, z);
            })
        .filter(
            spot ->
                spot.getBlockY() >= spot.getWorld().getMinHeight()
                    && spot.getBlockY() < spot.getWorld().getMaxHeight()
                    && spot.getWorld().isChunkLoaded(spot.getBlockX() >> 4, spot.getBlockZ() >> 4))
        .map(Location::getBlock);
  }
}
