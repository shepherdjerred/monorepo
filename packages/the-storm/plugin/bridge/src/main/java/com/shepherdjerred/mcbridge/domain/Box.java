package com.shepherdjerred.mcbridge.domain;

/**
 * An inclusive, normalized box in one world: {@code min} holds the smallest coordinate on every
 * axis.
 */
public record Box(String world, BlockPos min, BlockPos max) {

  public Box {
    if (min.x() > max.x() || min.y() > max.y() || min.z() > max.z()) {
      throw new IllegalArgumentException("box is not normalized; build it with Box.of");
    }
  }

  /** Normalizes two corners into a box. */
  public static Box of(String world, BlockPos a, BlockPos b) {
    return new Box(
        world,
        new BlockPos(Math.min(a.x(), b.x()), Math.min(a.y(), b.y()), Math.min(a.z(), b.z())),
        new BlockPos(Math.max(a.x(), b.x()), Math.max(a.y(), b.y()), Math.max(a.z(), b.z())));
  }

  public int sizeX() {
    return max.x() - min.x() + 1;
  }

  public int sizeY() {
    return max.y() - min.y() + 1;
  }

  public int sizeZ() {
    return max.z() - min.z() + 1;
  }

  /** The size as a position, as the wire {@code size} field. */
  public BlockPos size() {
    return new BlockPos(sizeX(), sizeY(), sizeZ());
  }

  /** Block count, as a long so huge boxes cannot overflow before the limit check. */
  public long volume() {
    return (long) sizeX() * sizeY() * sizeZ();
  }

  /** Number of 16x16 chunk columns the box touches. */
  public long chunkColumns() {
    long chunksX = (long) (max.x() >> 4) - (min.x() >> 4) + 1;
    long chunksZ = (long) (max.z() >> 4) - (min.z() >> 4) + 1;
    return chunksX * chunksZ;
  }

  /** YZX index of a position inside the box: {@code (y*sizeZ + z)*sizeX + x}, relative to min. */
  public int index(int x, int y, int z) {
    int rx = x - min.x();
    int ry = y - min.y();
    int rz = z - min.z();
    return (ry * sizeZ() + rz) * sizeX() + rx;
  }

  /** Rejects a box whose Y range leaves the world's build height. */
  public void requireWithinHeight(int worldMinY, int worldMaxY) {
    if (min.y() < worldMinY || max.y() > worldMaxY) {
      throw BridgeException.badRequest(
          "box y range "
              + min.y()
              + ".."
              + max.y()
              + " is outside world "
              + world
              + " height "
              + worldMinY
              + ".."
              + worldMaxY);
    }
  }

  /** Rejects a box larger than {@code limit} blocks. */
  public void requireVolumeAtMost(long limit) {
    if (volume() > limit) {
      throw new BridgeException(
          ErrorCode.TOO_LARGE, "box volume " + volume() + " exceeds the limit of " + limit);
    }
  }
}
