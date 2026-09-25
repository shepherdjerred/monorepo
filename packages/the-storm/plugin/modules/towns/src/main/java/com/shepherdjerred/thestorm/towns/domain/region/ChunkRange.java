package com.shepherdjerred.thestorm.towns.domain.region;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import java.util.ArrayList;
import java.util.List;

/**
 * Whole chunks from {@code from} to {@code to}, inclusive, at every height.
 *
 * @param world the world's name
 * @param from the corner with the smaller coordinates
 * @param to the corner with the larger coordinates
 */
public record ChunkRange(String world, ChunkCorner from, ChunkCorner to) implements Area {

  public ChunkRange {
    if (world.isBlank()) {
      throw new IllegalArgumentException("world must not be blank");
    }
    if (from.x() > to.x() || from.z() > to.z()) {
      throw new IllegalArgumentException(
          "from " + from + " must not be past to " + to + " on either axis");
    }
  }

  @Override
  public boolean contains(String world, int x, int y, int z) {
    var chunkX = x >> 4;
    var chunkZ = z >> 4;
    return this.world.equals(world)
        && chunkX >= from.x()
        && chunkX <= to.x()
        && chunkZ >= from.z()
        && chunkZ <= to.z();
  }

  @Override
  public boolean footprintContains(ChunkPos chunk) {
    return world.equals(chunk.world())
        && chunk.x() >= from.x()
        && chunk.x() <= to.x()
        && chunk.z() >= from.z()
        && chunk.z() <= to.z();
  }

  @Override
  public List<ChunkPos> footprint() {
    var chunks = new ArrayList<ChunkPos>();
    for (var x = from.x(); x <= to.x(); x++) {
      for (var z = from.z(); z <= to.z(); z++) {
        chunks.add(new ChunkPos(world, x, z));
      }
    }
    return List.copyOf(chunks);
  }

  @Override
  public long footprintSize() {
    return ((long) to.x() - from.x() + 1) * ((long) to.z() - from.z() + 1);
  }
}
