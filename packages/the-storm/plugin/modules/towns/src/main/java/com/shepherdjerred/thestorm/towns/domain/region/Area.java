package com.shepherdjerred.thestorm.towns.domain.region;

import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import java.util.List;

/** Part of an admin region. */
public sealed interface Area permits ChunkRange, Cuboid {

  String world();

  /** True when {@code block} is inside this area. */
  default boolean contains(BlockPos block) {
    return contains(block.world(), block.x(), block.y(), block.z());
  }

  /** True when block ({@code x}, {@code y}, {@code z}) of {@code world} is inside this area. */
  boolean contains(String world, int x, int y, int z);

  /** True when this area overlaps any part of {@code chunk}. */
  boolean footprintContains(ChunkPos chunk);

  /** Every chunk this area overlaps, even partly. */
  List<ChunkPos> footprint();

  /** How many chunks {@link #footprint()} has, without building it. */
  long footprintSize();
}
