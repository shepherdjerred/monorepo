package com.shepherdjerred.thestorm.quests.domain.model;

/**
 * A named sphere in a world, for reach objectives, region conditions, teleports and spawns.
 *
 * @param id the region id
 * @param name its display name
 * @param world the world key, such as {@code minecraft:overworld}
 * @param x the centre's x
 * @param y the centre's y
 * @param z the centre's z
 * @param radius how far from the centre counts as inside, in blocks
 */
public record Region(
    String id, String name, String world, double x, double y, double z, double radius) {

  public Region {
    if (radius <= 0) {
      throw new IllegalArgumentException("a region needs a positive radius");
    }
  }

  /** Whether the point is inside. */
  public boolean contains(String inWorld, double px, double py, double pz) {
    if (!world.equals(inWorld)) {
      return false;
    }
    var dx = px - x;
    var dy = py - y;
    var dz = pz - z;
    return dx * dx + dy * dy + dz * dz <= radius * radius;
  }
}
