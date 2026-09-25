package com.shepherdjerred.thestorm.towns.domain.region;

import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import java.util.List;

/** Part of an admin region. */
public sealed interface Area permits ChunkRange, Cuboid {

  String world();

  /** True when {@code block} is inside this area. */
  boolean contains(BlockPos block);

  /** Every chunk this area overlaps, even partly. */
  List<ChunkPos> footprint();

  /** How many chunks {@link #footprint()} has, without building it. */
  long footprintSize();
}
