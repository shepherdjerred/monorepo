package com.shepherdjerred.thestorm.qol.domain.grave;

/**
 * A block in a world.
 *
 * @param world the world name
 * @param x block x
 * @param y block y
 * @param z block z
 */
public record GravePos(String world, int x, int y, int z) {

  public GravePos {
    if (world.isBlank()) {
      throw new IllegalArgumentException("world must not be blank");
    }
  }

  /** The block {@code dx}, {@code dy}, {@code dz} away in the same world. */
  public GravePos offset(int dx, int dy, int dz) {
    return new GravePos(world, x + dx, y + dy, z + dz);
  }

  /** "x, y, z in world", for players. */
  public String describe() {
    return x + ", " + y + ", " + z + " in " + world;
  }
}
