package com.shepherdjerred.thestorm.npcs.domain.geo;

import java.util.regex.Pattern;

/**
 * A position in a named world with a facing.
 *
 * @param world the world's namespaced key, such as {@code minecraft:overworld}
 * @param position where
 * @param rotation which way to face
 */
public record Spot(String world, Vec3 position, Rotation rotation) {

  private static final Pattern WORLD_KEY = Pattern.compile("[a-z0-9_.-]+:[a-z0-9_./-]+");

  public Spot {
    if (!WORLD_KEY.matcher(world).matches()) {
      throw new IllegalArgumentException(
          "world must be a namespaced key like minecraft:overworld: " + world);
    }
  }

  /** The chunk this spot is in. */
  public ChunkKey chunk() {
    return ChunkKey.of(world, position);
  }

  /** The same world and facing at another position. */
  public Spot at(Vec3 other) {
    return new Spot(world, other, rotation);
  }
}
