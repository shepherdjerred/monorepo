package com.shepherdjerred.thestorm.towns.domain.region;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import java.util.ArrayList;
import java.util.List;

/**
 * A box of blocks from {@code from} to {@code to}, inclusive.
 *
 * @param world the world's name
 * @param from the corner with the smaller coordinates
 * @param to the corner with the larger coordinates
 */
public record Cuboid(String world, BlockCorner from, BlockCorner to) implements Area {

  public Cuboid {
    if (world.isBlank()) {
      throw new IllegalArgumentException("world must not be blank");
    }
    if (from.x() > to.x() || from.y() > to.y() || from.z() > to.z()) {
      throw new IllegalArgumentException(
          "from " + from + " must not be past to " + to + " on any axis");
    }
  }

  @Override
  public boolean contains(String world, int x, int y, int z) {
    return this.world.equals(world)
        && x >= from.x()
        && x <= to.x()
        && y >= from.y()
        && y <= to.y()
        && z >= from.z()
        && z <= to.z();
  }

  @Override
  public boolean footprintContains(ChunkPos chunk) {
    return world.equals(chunk.world())
        && chunk.x() >= from.x() >> 4
        && chunk.x() <= to.x() >> 4
        && chunk.z() >= from.z() >> 4
        && chunk.z() <= to.z() >> 4;
  }

  @Override
  public List<ChunkPos> footprint() {
    var chunks = new ArrayList<ChunkPos>();
    for (var x = from.x() >> 4; x <= to.x() >> 4; x++) {
      for (var z = from.z() >> 4; z <= to.z() >> 4; z++) {
        chunks.add(new ChunkPos(world, x, z));
      }
    }
    return List.copyOf(chunks);
  }

  @Override
  public long footprintSize() {
    return ((long) (to.x() >> 4) - (from.x() >> 4) + 1)
        * ((long) (to.z() >> 4) - (from.z() >> 4) + 1);
  }
}
