package com.shepherdjerred.thestorm.shards.domain;

/**
 * A block players right-click to upgrade gear. The first configured altar is the emerald block in
 * the spawn windmill.
 *
 * @param world the world key, such as {@code minecraft:overworld}
 * @param x block x
 * @param y block y
 * @param z block z
 */
public record AltarLocation(String world, int x, int y, int z) {

  public AltarLocation {
    Checks.key("altars[].world", world);
  }

  /** Whether this altar is the block at the given position. */
  public boolean isAt(String blockWorld, int blockX, int blockY, int blockZ) {
    return world.equals(blockWorld) && x == blockX && y == blockY && z == blockZ;
  }
}
