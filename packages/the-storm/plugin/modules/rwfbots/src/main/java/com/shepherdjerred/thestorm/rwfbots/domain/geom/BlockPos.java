package com.shepherdjerred.thestorm.rwfbots.domain.geom;

/** A block cell in world coordinates. */
public record BlockPos(int x, int y, int z) {

  /** The cell containing {@code point}. */
  public static BlockPos of(Vec3 point) {
    return new BlockPos(
        (int) Math.floor(point.x()), (int) Math.floor(point.y()), (int) Math.floor(point.z()));
  }

  /** Where feet stand in the middle of this cell's floor. */
  public Vec3 feet() {
    return new Vec3(x + 0.5, y, z + 0.5);
  }

  /** The middle of this cell. */
  public Vec3 center() {
    return new Vec3(x + 0.5, y + 0.5, z + 0.5);
  }

  public BlockPos offset(int dx, int dy, int dz) {
    return new BlockPos(x + dx, y + dy, z + dz);
  }

  public BlockPos up() {
    return offset(0, 1, 0);
  }

  public BlockPos down() {
    return offset(0, -1, 0);
  }

  /** The Manhattan distance to {@code other}. */
  public int manhattan(BlockPos other) {
    return Math.abs(x - other.x) + Math.abs(y - other.y) + Math.abs(z - other.z);
  }
}
