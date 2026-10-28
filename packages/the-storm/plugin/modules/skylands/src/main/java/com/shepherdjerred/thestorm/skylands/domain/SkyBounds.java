package com.shepherdjerred.thestorm.skylands.domain;

/** Inclusive block bounds, used for plot ownership and collision checks. */
public record SkyBounds(SkyPosition min, SkyPosition max) {
  public boolean contains(SkyPosition p) {
    return p.x() >= min.x()
        && p.x() <= max.x()
        && p.y() >= min.y()
        && p.y() <= max.y()
        && p.z() >= min.z()
        && p.z() <= max.z();
  }

  public boolean intersects(SkyBounds b) {
    return min.x() <= b.max.x()
        && max.x() >= b.min.x()
        && min.y() <= b.max.y()
        && max.y() >= b.min.y()
        && min.z() <= b.max.z()
        && max.z() >= b.min.z();
  }

  public SkyBounds expanded(int margin) {
    return new SkyBounds(
        min.add(new SkyPosition(-margin, -margin, -margin)),
        max.add(new SkyPosition(margin, margin, margin)));
  }

  public boolean containsChunk(int x, int z) {
    return min.x() <= x * 16 + 15
        && max.x() >= x * 16
        && min.z() <= z * 16 + 15
        && max.z() >= z * 16;
  }
}
