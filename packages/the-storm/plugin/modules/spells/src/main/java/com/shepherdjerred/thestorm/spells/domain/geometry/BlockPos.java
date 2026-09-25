package com.shepherdjerred.thestorm.spells.domain.geometry;

/** A block position in one world. */
public record BlockPos(int x, int y, int z) {

  public BlockPos offset(int dx, int dy, int dz) {
    return new BlockPos(x + dx, y + dy, z + dz);
  }

  public BlockPos above() {
    return offset(0, 1, 0);
  }

  public BlockPos below() {
    return offset(0, -1, 0);
  }

  /** The block containing {@code point}. */
  public static BlockPos containing(Vec3 point) {
    return new BlockPos(
        (int) Math.floor(point.x()), (int) Math.floor(point.y()), (int) Math.floor(point.z()));
  }

  /** The centre of this block's floor: where a player stands on it. */
  public Vec3 feet() {
    return new Vec3(x + 0.5, y, z + 0.5);
  }

  /** The squared distance between block origins. */
  public int distanceSquared(BlockPos other) {
    var dx = x - other.x;
    var dy = y - other.y;
    var dz = z - other.z;
    return dx * dx + dy * dy + dz * dz;
  }
}
