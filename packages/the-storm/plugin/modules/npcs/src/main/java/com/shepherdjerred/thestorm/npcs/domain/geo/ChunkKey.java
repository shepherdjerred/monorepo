package com.shepherdjerred.thestorm.npcs.domain.geo;

import java.util.LinkedHashSet;
import java.util.Set;

/** A 16x16 chunk column in a world. */
public record ChunkKey(String world, int x, int z) {

  /** The chunk holding {@code position}. */
  public static ChunkKey of(String world, Vec3 position) {
    return new ChunkKey(
        world,
        Math.floorDiv((int) Math.floor(position.x()), 16),
        Math.floorDiv((int) Math.floor(position.z()), 16));
  }

  /** Every chunk touched by the square of half-width {@code radius} around {@code center}. */
  public static Set<ChunkKey> around(String world, Vec3 center, double radius) {
    var min = of(world, center.minus(new Vec3(radius, 0, radius)));
    var max = of(world, center.plus(new Vec3(radius, 0, radius)));
    var chunks = new LinkedHashSet<ChunkKey>();
    for (var x = min.x; x <= max.x; x++) {
      for (var z = min.z; z <= max.z; z++) {
        chunks.add(new ChunkKey(world, x, z));
      }
    }
    return chunks;
  }
}
