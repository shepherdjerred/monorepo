package com.shepherdjerred.thestorm.skylands.domain;

/** World or template coordinates. A template's origin is always explicit. */
public record SkyPosition(int x, int y, int z) {
  public SkyPosition add(SkyPosition offset) {
    return new SkyPosition(x + offset.x, y + offset.y, z + offset.z);
  }

  public SkyPosition above(int distance) {
    return new SkyPosition(x, y + distance, z);
  }

  public long distanceSquared(SkyPosition other) {
    long dx = (long) x - other.x, dy = (long) y - other.y, dz = (long) z - other.z;
    return dx * dx + dy * dy + dz * dz;
  }

  public double distance(SkyPosition other) {
    return Math.sqrt((double) distanceSquared(other));
  }
}
