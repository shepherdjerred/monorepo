package com.shepherdjerred.thestorm.world.domain;

/** A native Minecraft border; size is its full diameter, rather than a radius. */
public record WorldBorderSpec(String world, double centerX, double centerZ, double size) {

  public WorldBorderSpec {
    if (world == null || world.isBlank()) {
      throw new IllegalArgumentException("border world is required");
    }
    if (!Double.isFinite(centerX)
        || !Double.isFinite(centerZ)
        || Math.abs(centerX) > 29_999_984
        || Math.abs(centerZ) > 29_999_984) {
      throw new IllegalArgumentException("border center must be inside Minecraft's world bounds");
    }
    if (!Double.isFinite(size) || size < 1 || size > 59_999_968) {
      throw new IllegalArgumentException("border size must be a diameter between 1 and 59999968");
    }
  }
}
