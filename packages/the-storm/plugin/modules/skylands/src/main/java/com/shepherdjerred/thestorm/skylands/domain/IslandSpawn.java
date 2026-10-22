package com.shepherdjerred.thestorm.skylands.domain;

import static java.util.Comparator.comparingLong;

import java.util.Comparator;
import java.util.Optional;

/**
 * Finds solid island ground for the world spawn from the terrain alone, so world creation never
 * searches the void. Chunks are searched in square rings around chunk {@code (0, 0)}; the first
 * ring holding a suitable column wins, and within it the column nearest block {@code (0, 0)}.
 */
public final class IslandSpawn {

  /** Stone below the top a spawn column needs, so the spawn is not on a thin overhang. */
  static final int MIN_DEPTH = 6;

  /** Columns this far away in each axis must have a top within one block of the spawn's. */
  private static final int REACH = 2;

  private static final Comparator<SpawnColumn> NEAREST =
      comparingLong(
              (SpawnColumn column) ->
                  (long) column.x() * column.x() + (long) column.z() * column.z())
          .thenComparingInt(SpawnColumn::x)
          .thenComparingInt(SpawnColumn::z);

  private IslandSpawn() {}

  /** The spawn column within {@code radiusChunks} rings of the origin, if any. */
  public static Optional<SpawnColumn> find(SkyTerrain terrain, int radiusChunks) {
    for (var ring = 0; ring <= radiusChunks; ring++) {
      var best = Optional.<SpawnColumn>empty();
      for (var chunkX = -ring; chunkX <= ring; chunkX++) {
        for (var chunkZ = -ring; chunkZ <= ring; chunkZ++) {
          if (Math.max(Math.abs(chunkX), Math.abs(chunkZ)) == ring) {
            best = nearer(best, bestIn(terrain.chunk(chunkX, chunkZ), chunkX, chunkZ));
          }
        }
      }
      if (best.isPresent()) {
        return best;
      }
    }
    return Optional.empty();
  }

  private static Optional<SpawnColumn> bestIn(IslandChunk chunk, int chunkX, int chunkZ) {
    var best = Optional.<SpawnColumn>empty();
    for (var x = REACH; x < 16 - REACH; x++) {
      for (var z = REACH; z < 16 - REACH; z++) {
        if (suitable(chunk, x, z)) {
          var top = chunk.top(x, z).orElseThrow();
          best = nearer(best, Optional.of(new SpawnColumn(chunkX * 16 + x, top, chunkZ * 16 + z)));
        }
      }
    }
    return best;
  }

  private static boolean suitable(IslandChunk chunk, int x, int z) {
    var top = chunk.top(x, z);
    if (top.isEmpty() || chunk.depthBelow(x, top.getAsInt(), z) < MIN_DEPTH) {
      return false;
    }
    return level(chunk, x - REACH, z, top.getAsInt())
        && level(chunk, x + REACH, z, top.getAsInt())
        && level(chunk, x, z - REACH, top.getAsInt())
        && level(chunk, x, z + REACH, top.getAsInt());
  }

  private static boolean level(IslandChunk chunk, int x, int z, int top) {
    var neighbour = chunk.top(x, z);
    return neighbour.isPresent() && Math.abs(neighbour.getAsInt() - top) <= 1;
  }

  private static Optional<SpawnColumn> nearer(
      Optional<SpawnColumn> current, Optional<SpawnColumn> candidate) {
    if (current.isEmpty()) {
      return candidate;
    }
    if (candidate.isEmpty()) {
      return current;
    }
    return Optional.of(
        NEAREST.compare(candidate.orElseThrow(), current.orElseThrow()) < 0
            ? candidate.orElseThrow()
            : current.orElseThrow());
  }
}
